create type public.order_status as enum ('pending','confirmed','cancelled','completed');
create type public.order_address_type as enum ('billing','shipping');
create type public.order_adjustment_type as enum ('coupon','promotion','manual_discount','payment_discount','shipping_discount','fee','correction');
create type public.order_adjustment_direction as enum ('discount','charge');
create type public.order_actor_type as enum ('system','customer','admin','worker');

alter table public.stores add column next_order_sequence bigint not null default 1
  constraint stores_next_order_sequence_check check (next_order_sequence >= 1);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  checkout_session_id uuid unique references public.checkout_sessions(id) on delete restrict,
  order_sequence bigint not null check (order_sequence >= 1),
  order_number text not null check (length(btrim(order_number)) between 1 and 80),
  status public.order_status not null default 'pending',
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  items_subtotal_minor bigint not null check (items_subtotal_minor >= 0),
  discount_total_minor bigint not null default 0 check (discount_total_minor >= 0),
  shipping_total_minor bigint not null default 0 check (shipping_total_minor >= 0),
  tax_total_minor bigint not null default 0 check (tax_total_minor >= 0),
  fee_total_minor bigint not null default 0 check (fee_total_minor >= 0),
  grand_total_minor bigint not null check (grand_total_minor >= 0),
  contact_name text not null check (length(btrim(contact_name)) between 1 and 200),
  contact_email text not null check (contact_email = lower(btrim(contact_email)) and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  contact_phone text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  tax_id_type text check (tax_id_type is null or tax_id_type in ('cpf','cnpj')),
  tax_id_ciphertext text,
  tax_id_fingerprint text check (tax_id_fingerprint is null or tax_id_fingerprint ~ '^[0-9a-f]{64}$'),
  tax_id_masked text,
  correlation_id uuid not null default gen_random_uuid() unique,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  completed_at timestamptz,
  constraint orders_store_sequence_unique unique(store_id,order_sequence),
  constraint orders_store_number_unique unique(store_id,order_number),
  constraint orders_totals_check check (grand_total_minor = items_subtotal_minor - discount_total_minor + shipping_total_minor + tax_total_minor + fee_total_minor and discount_total_minor <= items_subtotal_minor + shipping_total_minor + tax_total_minor + fee_total_minor),
  constraint orders_tax_bundle_check check ((tax_id_type is null and tax_id_ciphertext is null and tax_id_fingerprint is null and tax_id_masked is null) or (tax_id_type is not null and tax_id_ciphertext is not null and tax_id_fingerprint is not null)),
  constraint orders_terminal_timestamp_check check ((status='cancelled' and cancelled_at is not null and completed_at is null) or (status='completed' and completed_at is not null and cancelled_at is null) or (status in ('pending','confirmed') and cancelled_at is null and completed_at is null))
);
create index orders_customer_store_idx on public.orders(customer_id,store_id,created_at desc,id) where customer_id is not null;
create index orders_store_status_idx on public.orders(store_id,status,created_at,id);
create index orders_created_idx on public.orders(created_at,id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete restrict,
  line_number integer not null check (line_number>0), product_id uuid references public.products(id) on delete restrict,
  product_variant_id uuid references public.product_variants(id) on delete restrict,
  sku_snapshot text not null check (length(btrim(sku_snapshot)) between 1 and 200), gtin_snapshot text check (gtin_snapshot is null or gtin_snapshot ~ '^[0-9]{8,14}$'),
  product_name_snapshot text not null check (length(btrim(product_name_snapshot)) between 1 and 300), variant_label_snapshot text,
  quantity bigint not null check (quantity>0), unit_regular_amount_minor bigint not null check(unit_regular_amount_minor>=0),
  unit_effective_amount_minor bigint not null check(unit_effective_amount_minor>=0 and unit_effective_amount_minor<=unit_regular_amount_minor),
  line_subtotal_minor bigint not null check(line_subtotal_minor>=0), line_discount_minor bigint not null default 0 check(line_discount_minor>=0),
  line_tax_minor bigint not null default 0 check(line_tax_minor>=0), line_total_minor bigint not null check(line_total_minor>=0),
  currency char(3) not null check(currency ~ '^[A-Z]{3}$'), source_fingerprint text not null check(source_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(), constraint order_items_line_unique unique(order_id,line_number), constraint order_items_id_order_unique unique(id,order_id),
  constraint order_items_subtotal_check check(line_subtotal_minor=unit_effective_amount_minor*quantity),
  constraint order_items_total_check check(line_discount_minor<=line_subtotal_minor+line_tax_minor and line_total_minor=line_subtotal_minor-line_discount_minor+line_tax_minor)
);
create index order_items_order_idx on public.order_items(order_id,line_number,id);
create index order_items_variant_idx on public.order_items(product_variant_id,order_id) where product_variant_id is not null;

create table public.order_addresses (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete restrict,
  address_type public.order_address_type not null, source_customer_address_id uuid references public.customer_addresses(id) on delete set null,
  recipient text not null check(length(btrim(recipient)) between 1 and 200), company text, street text not null check(length(btrim(street)) between 1 and 250),
  number text not null check(length(btrim(number)) between 1 and 50), complement text, neighborhood text not null check(length(btrim(neighborhood)) between 1 and 150),
  city text not null check(length(btrim(city)) between 1 and 150), state char(2) not null check(state=upper(state) and state ~ '^[A-Z]{2}$'),
  postal_code text not null check(postal_code ~ '^[0-9]{8}$'), country char(2) not null default 'BR' check(country=upper(country) and country ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(), constraint order_addresses_type_unique unique(order_id,address_type)
);
create index order_addresses_order_idx on public.order_addresses(order_id,address_type,id);

create table public.order_adjustments (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete restrict,
  order_item_id uuid, adjustment_type public.order_adjustment_type not null,
  direction public.order_adjustment_direction not null, amount_minor bigint not null check(amount_minor>0), currency char(3) not null check(currency ~ '^[A-Z]{3}$'),
  code_snapshot text, description_snapshot text not null check(length(btrim(description_snapshot)) between 1 and 300),
  reverses_adjustment_id uuid references public.order_adjustments(id) on delete restrict, correlation_id uuid not null default gen_random_uuid(), created_at timestamptz not null default now(),
  constraint order_adjustments_reversal_unique unique(reverses_adjustment_id),
  constraint order_adjustments_item_order_fk foreign key(order_item_id,order_id) references public.order_items(id,order_id) on delete restrict,
  constraint order_adjustments_direction_check check((adjustment_type='fee' and direction='charge') or adjustment_type='correction' or (adjustment_type<>'fee' and direction='discount')),
  constraint order_adjustments_no_self_reversal check(reverses_adjustment_id is null or reverses_adjustment_id<>id)
);
create index order_adjustments_order_idx on public.order_adjustments(order_id,created_at,id);
create index order_adjustments_item_idx on public.order_adjustments(order_item_id,id) where order_item_id is not null;

create table public.order_status_events (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete restrict,
  from_status public.order_status, to_status public.order_status not null, actor_type public.order_actor_type not null,
  actor_id text, reason_code text check(reason_code is null or reason_code ~ '^[a-z][a-z0-9_.-]*$'), reason text,
  correlation_id uuid not null, created_at timestamptz not null default now(),
  constraint order_status_events_change_check check(from_status is null or from_status<>to_status)
);
create index order_status_events_order_idx on public.order_status_events(order_id,created_at,id);
create unique index order_status_events_initial_unique on public.order_status_events(order_id) where from_status is null;
create unique index order_status_events_correlation_unique on public.order_status_events(order_id,correlation_id);

create function public.allocate_native_order_number(p_store_id uuid)
returns table(order_sequence bigint,order_number text) language plpgsql security definer set search_path='' as $$
declare seq bigint; store_code text; yr text;
begin
  update public.stores s set next_order_sequence=s.next_order_sequence+1 where s.id=p_store_id and s.status='active'
    returning s.next_order_sequence-1,upper(s.code) into seq,store_code;
  if not found then raise exception using errcode='P0002',message='active_store_not_found'; end if;
  yr:=to_char(clock_timestamp(),'YYYY'); order_sequence:=seq;
  order_number:=concat(store_code,'-',yr,'-',lpad(seq::text,6,'0')); return next;
end $$;

create function public.enforce_native_order_immutability() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception using errcode='23514',message='order_history_delete_forbidden'; end if;
  if tg_table_name='orders' then
    if new.status=old.status or new.store_id<>old.store_id or new.customer_id is distinct from old.customer_id or new.checkout_session_id is distinct from old.checkout_session_id
      or new.order_sequence<>old.order_sequence or new.order_number<>old.order_number or new.currency<>old.currency
      or new.items_subtotal_minor<>old.items_subtotal_minor or new.discount_total_minor<>old.discount_total_minor or new.shipping_total_minor<>old.shipping_total_minor
      or new.tax_total_minor<>old.tax_total_minor or new.fee_total_minor<>old.fee_total_minor or new.grand_total_minor<>old.grand_total_minor
      or new.contact_name<>old.contact_name or new.contact_email<>old.contact_email or new.contact_phone is distinct from old.contact_phone
      or new.tax_id_type is distinct from old.tax_id_type or new.tax_id_ciphertext is distinct from old.tax_id_ciphertext
      or new.tax_id_fingerprint is distinct from old.tax_id_fingerprint or new.tax_id_masked is distinct from old.tax_id_masked
      or new.correlation_id<>old.correlation_id then raise exception using errcode='23514',message='order_commercial_snapshot_immutable'; end if;
    return new;
  end if;
  raise exception using errcode='23514',message='order_snapshot_immutable';
end $$;

create function public.validate_native_order_scope() returns trigger language plpgsql security invoker set search_path='' as $$
declare c public.checkout_sessions;
begin
  if new.checkout_session_id is not null then
    select * into c from public.checkout_sessions where id=new.checkout_session_id;
    if not found or c.store_id<>new.store_id or c.customer_id is distinct from new.customer_id then
      raise exception using errcode='23514',message='order_checkout_scope_mismatch';
    end if;
  end if;
  return new;
end $$;

create function public.enforce_native_order_status_transition() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status=old.status then return new; end if;
  if not ((old.status='pending' and new.status in ('confirmed','cancelled')) or (old.status='confirmed' and new.status in ('completed','cancelled'))) then
    raise exception using errcode='23514',message='invalid_order_status_transition';
  end if;
  if new.version<>old.version+1 then raise exception using errcode='40001',message='invalid_order_version_transition'; end if;
  return new;
end $$;

create function public.transition_native_order(p_order_id uuid,p_expected public.order_status,p_target public.order_status,p_expected_version bigint,p_actor_type public.order_actor_type,p_actor_id text,p_reason_code text,p_reason text,p_correlation_id uuid)
returns public.orders language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002',message='order_not_found'; end if;
  if o.status<>p_expected or o.version<>p_expected_version then raise exception using errcode='40001',message='stale_order_transition'; end if;
  if not ((p_expected='pending' and p_target in ('confirmed','cancelled')) or (p_expected='confirmed' and p_target in ('completed','cancelled'))) then
    raise exception using errcode='23514',message='invalid_order_status_transition'; end if;
  update public.orders set status=p_target,version=version+1,updated_at=now(),cancelled_at=case when p_target='cancelled' then now() else null end,completed_at=case when p_target='completed' then now() else null end where id=o.id returning * into o;
  insert into public.order_status_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,reason,correlation_id)
    values(o.id,p_expected,p_target,p_actor_type,p_actor_id,p_reason_code,p_reason,p_correlation_id);
  return o;
end $$;

create function public.validate_native_order_totals(p_order_id uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare o public.orders; subtotal bigint; line_discount bigint; line_tax bigint; adjustment_discount bigint; adjustment_fee bigint;
begin
  select * into o from public.orders where id=p_order_id;
  if not found then raise exception using errcode='P0002',message='order_not_found'; end if;
  select coalesce(sum(line_subtotal_minor),0),coalesce(sum(line_discount_minor),0),coalesce(sum(line_tax_minor),0) into subtotal,line_discount,line_tax from public.order_items where order_id=o.id;
  select coalesce(sum(case when a.adjustment_type<>'correction' and a.direction='discount' then a.amount_minor when a.adjustment_type='correction' and a.direction='charge' and reversed.direction='discount' then -a.amount_minor else 0 end),0),
    coalesce(sum(case when a.adjustment_type<>'correction' and a.direction='charge' then a.amount_minor when a.adjustment_type='correction' and a.direction='discount' and reversed.direction='charge' then -a.amount_minor else 0 end),0)
    into adjustment_discount,adjustment_fee from public.order_adjustments a left join public.order_adjustments reversed on reversed.id=a.reverses_adjustment_id where a.order_id=o.id;
  if o.items_subtotal_minor<>subtotal or o.discount_total_minor<>line_discount+adjustment_discount or o.tax_total_minor<>line_tax or o.fee_total_minor<>adjustment_fee then
    raise exception using errcode='23514',message='order_totals_mismatch'; end if;
  return true;
end $$;

create trigger orders_validate_scope before insert or update on public.orders for each row execute function public.validate_native_order_scope();
create trigger orders_status_transition before update of status on public.orders for each row execute function public.enforce_native_order_status_transition();
create trigger orders_immutable before update or delete on public.orders for each row execute function public.enforce_native_order_immutability();
create trigger order_items_immutable before update or delete on public.order_items for each row execute function public.enforce_native_order_immutability();
create trigger order_addresses_immutable before update or delete on public.order_addresses for each row execute function public.enforce_native_order_immutability();
create trigger order_adjustments_immutable before update or delete on public.order_adjustments for each row execute function public.enforce_native_order_immutability();
create trigger order_status_events_append_only before update or delete on public.order_status_events for each row execute function public.enforce_native_order_immutability();

alter table public.orders enable row level security; alter table public.order_items enable row level security; alter table public.order_addresses enable row level security;
alter table public.order_adjustments enable row level security; alter table public.order_status_events enable row level security;
revoke all on public.orders,public.order_items,public.order_addresses,public.order_adjustments,public.order_status_events from public,anon,authenticated;
revoke all on function public.allocate_native_order_number(uuid),public.enforce_native_order_immutability(),public.validate_native_order_scope(),public.enforce_native_order_status_transition(),public.transition_native_order(uuid,public.order_status,public.order_status,bigint,public.order_actor_type,text,text,text,uuid),public.validate_native_order_totals(uuid) from public,anon,authenticated;
grant select on public.orders,public.order_items,public.order_addresses,public.order_adjustments,public.order_status_events to persi_app,persi_worker;
grant execute on function public.allocate_native_order_number(uuid) to persi_app;
grant execute on function public.transition_native_order(uuid,public.order_status,public.order_status,bigint,public.order_actor_type,text,text,text,uuid) to persi_app,persi_worker;
grant execute on function public.validate_native_order_totals(uuid) to persi_app;
create policy orders_app_select on public.orders for select to persi_app using(true); create policy orders_worker_select on public.orders for select to persi_worker using(true);
create policy order_items_app_select on public.order_items for select to persi_app using(true); create policy order_items_worker_select on public.order_items for select to persi_worker using(true);
create policy order_addresses_app_select on public.order_addresses for select to persi_app using(true); create policy order_addresses_worker_select on public.order_addresses for select to persi_worker using(true);
create policy order_adjustments_app_select on public.order_adjustments for select to persi_app using(true); create policy order_adjustments_worker_select on public.order_adjustments for select to persi_worker using(true);
create policy order_status_events_app_select on public.order_status_events for select to persi_app using(true); create policy order_status_events_worker_select on public.order_status_events for select to persi_worker using(true);

comment on table public.orders is 'B.3-C2 durable native order aggregate; payment and shipment state are separate.';
comment on column public.orders.tax_id_ciphertext is 'Application-encrypted tax document; plaintext forbidden.';
