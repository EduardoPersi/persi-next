create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_-]*$'),
  name text not null check (length(btrim(name)) between 1 and 150),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  channel text,
  customer_segment text,
  priority integer not null default 0,
  status public.record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_lists_code_unique unique (code)
);

create table public.prices (
  id uuid primary key default gen_random_uuid(),
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  price_list_id uuid not null references public.price_lists(id) on delete restrict,
  list_amount_minor bigint not null check (list_amount_minor >= 0),
  sale_amount_minor bigint check (sale_amount_minor is null or sale_amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  status public.record_status not null default 'active',
  source text not null default 'manual' check (length(btrim(source)) between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prices_sale_not_above_list check (
    sale_amount_minor is null or sale_amount_minor <= list_amount_minor
  ),
  constraint prices_valid_period check (valid_to is null or valid_to > valid_from)
);

create index prices_variant_list_period_idx
  on public.prices (product_variant_id, price_list_id, valid_from desc);
create index prices_active_lookup_idx
  on public.prices (price_list_id, product_variant_id, valid_from desc)
  where status = 'active';

create function public.prevent_overlapping_prices()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.product_variant_id::text || ':' || new.price_list_id::text, 0)
  );

  if new.status = 'active' and exists (
    select 1
    from public.prices existing
    where existing.product_variant_id = new.product_variant_id
      and existing.price_list_id = new.price_list_id
      and existing.status = 'active'
      and existing.id <> new.id
      and tstzrange(existing.valid_from, existing.valid_to, '[)') &&
          tstzrange(new.valid_from, new.valid_to, '[)')
  ) then
    raise exception using errcode = '23P01', message = 'overlapping_active_price_period';
  end if;

  if new.currency <> (select currency from public.price_lists where id = new.price_list_id) then
    raise exception using errcode = '23514', message = 'price_currency_differs_from_price_list';
  end if;

  return new;
end;
$$;

create trigger prices_prevent_overlap
before insert or update on public.prices
for each row execute function public.prevent_overlapping_prices();

create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  price_id uuid not null references public.prices(id) on delete restrict,
  previous_list_amount_minor bigint check (previous_list_amount_minor is null or previous_list_amount_minor >= 0),
  new_list_amount_minor bigint not null check (new_list_amount_minor >= 0),
  previous_sale_amount_minor bigint check (previous_sale_amount_minor is null or previous_sale_amount_minor >= 0),
  new_sale_amount_minor bigint check (new_sale_amount_minor is null or new_sale_amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  source text not null check (length(btrim(source)) between 1 and 50),
  actor_reference text,
  source_event_id text,
  changed_at timestamptz not null default now(),
  constraint price_history_sale_check check (
    new_sale_amount_minor is null or new_sale_amount_minor <= new_list_amount_minor
  )
);

create unique index price_history_source_event_unique
  on public.price_history (source, source_event_id)
  where source_event_id is not null;
create index price_history_price_changed_idx on public.price_history (price_id, changed_at desc);

create function public.capture_price_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.list_amount_minor is distinct from new.list_amount_minor
    or old.sale_amount_minor is distinct from new.sale_amount_minor then
    insert into public.price_history (
      price_id, previous_list_amount_minor, new_list_amount_minor,
      previous_sale_amount_minor, new_sale_amount_minor, currency, source
    ) values (
      new.id, old.list_amount_minor, new.list_amount_minor,
      old.sale_amount_minor, new.sale_amount_minor, new.currency, new.source
    );
  end if;
  return new;
end;
$$;

create trigger price_lists_set_updated_at before update on public.price_lists
for each row execute function public.set_updated_at();
create trigger prices_set_updated_at before update on public.prices
for each row execute function public.set_updated_at();
create trigger prices_capture_history after update on public.prices
for each row execute function public.capture_price_history();

alter table public.price_lists enable row level security;
alter table public.prices enable row level security;
alter table public.price_history enable row level security;

comment on column public.prices.list_amount_minor is
  'Money in ISO-4217 minor units. PostgreSQL bigint maps to TypeScript bigint/string, never an unchecked number.';
