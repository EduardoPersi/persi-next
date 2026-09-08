-- B.3-C3-P1 deterministic store -> price list authority. Local/dark; no business data.
create type public.commercial_context as enum ('storefront_retail');

alter table public.price_lists add constraint price_lists_id_currency_unique unique(id,currency);

create table public.store_price_list_assignments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  price_list_id uuid not null,
  currency char(3) not null check(currency ~ '^[A-Z]{3}$'),
  commercial_context public.commercial_context not null,
  version bigint not null check(version>0),
  valid_from timestamptz not null,
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_price_assignments_list_currency_fk foreign key(price_list_id,currency)
    references public.price_lists(id,currency) on delete restrict,
  constraint store_price_assignments_version_unique unique(store_id,currency,commercial_context,version),
  constraint store_price_assignments_identity_unique unique(id,store_id,price_list_id,version,currency),
  constraint store_price_assignments_valid_period check(valid_to is null or valid_to>valid_from)
);

create index store_price_assignments_lookup_idx
  on public.store_price_list_assignments(store_id,currency,commercial_context,valid_from desc,valid_to);
create index store_price_assignments_list_idx
  on public.store_price_list_assignments(price_list_id,store_id,valid_from desc);

create function public.enforce_store_price_assignment_history()
returns trigger language plpgsql security invoker set search_path='' as $$
declare lock_key bigint; highest bigint;
begin
  if tg_op='DELETE' then
    raise exception using errcode='23514',message='STORE_PRICE_CONFIG_DELETE_FORBIDDEN';
  end if;
  if tg_op='UPDATE' and (
    new.store_id<>old.store_id or new.price_list_id<>old.price_list_id or
    new.currency<>old.currency or new.commercial_context<>old.commercial_context or
    new.version<>old.version or new.valid_from<>old.valid_from or
    old.valid_to is not null or new.valid_to is null
  ) then raise exception using errcode='23514',message='STORE_PRICE_CONFIG_IMMUTABLE'; end if;

  lock_key:=hashtextextended(concat_ws(':',new.store_id,new.currency,new.commercial_context),0);
  perform pg_advisory_xact_lock(lock_key);
  if tg_op='INSERT' then
    select max(a.version) into highest from public.store_price_list_assignments a
      where a.store_id=new.store_id and a.currency=new.currency and a.commercial_context=new.commercial_context;
    if highest is not null and new.version<=highest then
      raise exception using errcode='23514',message='STORE_PRICE_CONFIG_VERSION_NOT_MONOTONIC';
    end if;
  end if;
  if exists(
    select 1 from public.store_price_list_assignments a
    where a.store_id=new.store_id and a.currency=new.currency and a.commercial_context=new.commercial_context
      and a.id<>new.id
      and tstzrange(a.valid_from,a.valid_to,'[)') && tstzrange(new.valid_from,new.valid_to,'[)')
  ) then raise exception using errcode='23P01',message='STORE_PRICE_CONFIG_OVERLAP'; end if;
  new.updated_at=now(); return new;
end $$;

create trigger store_price_assignments_history_guard
before insert or update or delete on public.store_price_list_assignments
for each row execute function public.enforce_store_price_assignment_history();

create function public.resolve_store_price_authority(
  p_store_id uuid,p_currency char(3),p_commercial_context public.commercial_context,p_as_of timestamptz
) returns table(
  assignment_id uuid,assignment_version bigint,price_list_id uuid,currency char(3),
  commercial_context public.commercial_context,valid_from timestamptz,valid_to timestamptz
) language plpgsql security definer set search_path='' as $$
declare matches integer; selected public.store_price_list_assignments; list public.price_lists; store public.stores;
begin
  if p_as_of is null then raise exception using errcode='22023',message='STORE_PRICE_CONFIG_AS_OF_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':',p_store_id,p_currency,p_commercial_context),0));
  select * into store from public.stores s where s.id=p_store_id;
  if not found or store.status<>'active' then raise exception using errcode='P0002',message='STORE_PRICE_CONFIG_MISSING'; end if;
  select count(*) into matches from public.store_price_list_assignments a
    where a.store_id=p_store_id and a.currency=p_currency and a.commercial_context=p_commercial_context
      and a.valid_from<=p_as_of and (a.valid_to is null or a.valid_to>p_as_of);
  if matches=0 then raise exception using errcode='P0002',message='STORE_PRICE_CONFIG_MISSING'; end if;
  if matches<>1 then raise exception using errcode='23514',message='STORE_PRICE_CONFIG_AMBIGUOUS'; end if;
  select * into selected from public.store_price_list_assignments a
    where a.store_id=p_store_id and a.currency=p_currency and a.commercial_context=p_commercial_context
      and a.valid_from<=p_as_of and (a.valid_to is null or a.valid_to>p_as_of);
  select * into list from public.price_lists pl where pl.id=selected.price_list_id;
  if not found or list.status<>'active' then raise exception using errcode='23514',message='PRICE_LIST_INACTIVE'; end if;
  if list.currency<>selected.currency then raise exception using errcode='23514',message='PRICE_CURRENCY_MISMATCH'; end if;
  if p_commercial_context='storefront_retail' and list.channel is distinct from 'storefront' then
    raise exception using errcode='23514',message='PRICE_LIST_CHANNEL_MISMATCH';
  end if;
  return query select selected.id,selected.version,selected.price_list_id,selected.currency,
    selected.commercial_context,selected.valid_from,selected.valid_to;
end $$;

alter table public.checkout_sessions
  add column store_price_list_assignment_id uuid,
  add column store_price_list_assignment_version bigint,
  add column price_list_id uuid,
  add constraint checkout_sessions_authority_complete check(
    (store_price_list_assignment_id is null and store_price_list_assignment_version is null and price_list_id is null) or
    (store_price_list_assignment_id is not null and store_price_list_assignment_version is not null and price_list_id is not null)
  ),
  add constraint checkout_sessions_authority_version_positive check(store_price_list_assignment_version is null or store_price_list_assignment_version>0),
  add constraint checkout_sessions_authority_fk foreign key(
    store_price_list_assignment_id,store_id,price_list_id,store_price_list_assignment_version,currency
  ) references public.store_price_list_assignments(id,store_id,price_list_id,version,currency) on delete restrict;

create index checkout_sessions_authority_idx
  on public.checkout_sessions(store_price_list_assignment_id,store_price_list_assignment_version,id)
  where store_price_list_assignment_id is not null;

create function public.validate_checkout_price_authority()
returns trigger language plpgsql security invoker set search_path='' as $$
declare authority record; item_lists integer;
begin
  if tg_op='UPDATE' and old.status in ('ready','submitting','order_created') and (
    new.store_price_list_assignment_id is distinct from old.store_price_list_assignment_id or
    new.store_price_list_assignment_version is distinct from old.store_price_list_assignment_version or
    new.price_list_id is distinct from old.price_list_id
  ) then raise exception using errcode='23514',message='CHECKOUT_PRICE_AUTHORITY_IMMUTABLE'; end if;

  if new.status in ('ready','submitting','order_created') and new.store_price_list_assignment_id is null then
    if tg_op='UPDATE' and old.status='validating' then
      select * into authority from public.resolve_store_price_authority(new.store_id,new.currency,'storefront_retail',statement_timestamp());
      select count(distinct p.price_list_id) into item_lists
        from public.checkout_session_items i join public.prices p on p.id=i.price_id
        where i.checkout_session_id=new.id and p.price_list_id<>authority.price_list_id;
      if item_lists<>0 then raise exception using errcode='23514',message='CHECKOUT_PRICE_LIST_NOT_AUTHORITATIVE'; end if;
      new.store_price_list_assignment_id=authority.assignment_id;
      new.store_price_list_assignment_version=authority.assignment_version;
      new.price_list_id=authority.price_list_id;
    else raise exception using errcode='23514',message='CHECKOUT_PRICE_AUTHORITY_REQUIRED'; end if;
  end if;
  if new.status in ('ready','submitting','order_created') then
    select * into authority from public.resolve_store_price_authority(new.store_id,new.currency,'storefront_retail',statement_timestamp());
    if new.store_price_list_assignment_id<>authority.assignment_id or
       new.store_price_list_assignment_version<>authority.assignment_version or
       new.price_list_id<>authority.price_list_id then
      raise exception using errcode='23514',message='CHECKOUT_PRICE_AUTHORITY_MISMATCH';
    end if;
  end if;
  return new;
end $$;

create trigger checkout_sessions_price_authority
before insert or update on public.checkout_sessions
for each row execute function public.validate_checkout_price_authority();

alter table public.store_price_list_assignments enable row level security;
revoke all on public.store_price_list_assignments from public,anon,authenticated,persi_app,persi_worker,persi_readonly;
revoke all on function public.enforce_store_price_assignment_history(),
  public.resolve_store_price_authority(uuid,char(3),public.commercial_context,timestamptz),
  public.validate_checkout_price_authority() from public,anon,authenticated;
grant execute on function public.resolve_store_price_authority(uuid,char(3),public.commercial_context,timestamptz) to persi_app,persi_worker;

comment on table public.store_price_list_assignments is 'Versioned server-controlled store price authority; business rows are bootstrapped separately.';
comment on column public.checkout_sessions.store_price_list_assignment_version is 'Immutable authority version snapshot required before checkout becomes ready.';
