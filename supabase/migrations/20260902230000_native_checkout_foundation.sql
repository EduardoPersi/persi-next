-- B.3-C1 native checkout foundation. Local/dark: no runtime wiring and no orders.
create type public.checkout_session_status as enum (
  'open','validating','ready','submitting','order_created','expired','cancelled'
);

alter table public.carts
  add constraint carts_id_store_unique unique (id, store_id);

create table public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  cart_id uuid not null,
  customer_id uuid references public.customers(id) on delete restrict,
  status public.checkout_session_status not null default 'open',
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 16 and 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  cart_version bigint not null check (cart_version >= 0),
  correlation_id uuid not null default gen_random_uuid(),
  shipping_required boolean not null default true,
  expires_at timestamptz not null,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_sessions_cart_store_fk foreign key (cart_id, store_id)
    references public.carts(id, store_id) on delete restrict,
  constraint checkout_sessions_expiry_check check (expires_at > created_at),
  constraint checkout_sessions_store_idempotency_unique unique(store_id,idempotency_key),
  constraint checkout_sessions_correlation_unique unique(correlation_id)
);

create unique index checkout_sessions_active_cart_unique on public.checkout_sessions(cart_id)
  where status in ('open','validating','ready','submitting');
create index checkout_sessions_customer_store_idx on public.checkout_sessions(customer_id,store_id,status,updated_at desc,id)
  where customer_id is not null;
create index checkout_sessions_expiration_idx on public.checkout_sessions(expires_at,id)
  where status in ('open','validating','ready');

create table public.checkout_session_items (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  product_id uuid not null references public.products(id) on delete restrict,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  sku_snapshot text not null check (length(btrim(sku_snapshot)) between 1 and 200),
  product_name_snapshot text not null check (length(btrim(product_name_snapshot)) between 1 and 300),
  variant_label_snapshot text,
  quantity bigint not null check (quantity > 0),
  unit_regular_amount_minor bigint not null check (unit_regular_amount_minor >= 0),
  unit_effective_amount_minor bigint not null check (unit_effective_amount_minor >= 0),
  line_subtotal_minor bigint not null check (line_subtotal_minor >= 0),
  line_discount_minor bigint not null default 0 check (line_discount_minor >= 0),
  line_tax_minor bigint not null default 0 check (line_tax_minor >= 0),
  line_total_minor bigint not null check (line_total_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  price_id uuid not null references public.prices(id) on delete restrict,
  price_valid_from timestamptz not null,
  price_valid_to timestamptz,
  price_fingerprint text not null check (price_fingerprint ~ '^[0-9a-f]{64}$'),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint checkout_session_items_line_unique unique(checkout_session_id,line_number),
  constraint checkout_session_items_variant_unique unique(checkout_session_id,product_variant_id),
  constraint checkout_session_items_price_period_check check (price_valid_to is null or price_valid_to > price_valid_from),
  constraint checkout_session_items_effective_check check (unit_effective_amount_minor <= unit_regular_amount_minor),
  constraint checkout_session_items_subtotal_check check (line_subtotal_minor = unit_effective_amount_minor * quantity),
  constraint checkout_session_items_total_check check (
    line_discount_minor <= line_subtotal_minor + line_tax_minor and
    line_total_minor = line_subtotal_minor - line_discount_minor + line_tax_minor
  )
);

create index checkout_session_items_session_idx on public.checkout_session_items(checkout_session_id,line_number,id);
create index checkout_session_items_price_idx on public.checkout_session_items(price_id,checkout_session_id);

create table public.checkout_shipping_quotes (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.checkout_sessions(id) on delete cascade,
  quote_key text not null check (length(btrim(quote_key)) between 1 and 200),
  shipping_method_id uuid references public.shipping_methods(id) on delete restrict,
  provider public.external_system not null,
  external_service_code text not null check (length(btrim(external_service_code)) between 1 and 100),
  carrier_name text not null check (length(btrim(carrier_name)) between 1 and 150),
  service_name text not null check (length(btrim(service_name)) between 1 and 150),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  estimated_delivery_days integer check (estimated_delivery_days is null or estimated_delivery_days > 0),
  estimated_delivery_at timestamptz,
  destination_postcode text not null check (destination_postcode ~ '^[0-9]{8}$'),
  destination_fingerprint text not null check (destination_fingerprint ~ '^[0-9a-f]{64}$'),
  logistics_fingerprint text not null check (logistics_fingerprint ~ '^[0-9a-f]{64}$'),
  logistics_version text not null check (length(btrim(logistics_version)) between 1 and 100),
  provider_quote_reference text check (provider_quote_reference is null or length(btrim(provider_quote_reference)) between 1 and 200),
  is_selected boolean not null default false,
  quoted_at timestamptz not null,
  expires_at timestamptz not null,
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  constraint checkout_shipping_quotes_key_unique unique(checkout_session_id,quote_key),
  constraint checkout_shipping_quotes_expiry_check check (expires_at > quoted_at),
  constraint checkout_shipping_quotes_selection_check check (
    (is_selected and selected_at is not null) or (not is_selected and selected_at is null)
  )
);

create unique index checkout_shipping_quotes_selected_unique on public.checkout_shipping_quotes(checkout_session_id)
  where is_selected;
create index checkout_shipping_quotes_session_idx on public.checkout_shipping_quotes(checkout_session_id,created_at,id);
create index checkout_shipping_quotes_expiration_idx on public.checkout_shipping_quotes(expires_at,id)
  where is_selected;

alter table public.inventory_reservations
  add column checkout_session_item_id uuid references public.checkout_session_items(id) on delete restrict;
create unique index inventory_reservations_checkout_item_level_unique
  on public.inventory_reservations(checkout_session_item_id,inventory_level_id)
  where checkout_session_item_id is not null;
create index inventory_reservations_checkout_item_idx
  on public.inventory_reservations(checkout_session_item_id,status,id)
  where checkout_session_item_id is not null;

create function public.validate_checkout_session_cart()
returns trigger language plpgsql security invoker set search_path='' as $$
declare c public.carts;
begin
  select * into c from public.carts where id=new.cart_id;
  if not found or c.store_id<>new.store_id or c.currency<>new.currency then
    raise exception using errcode='23514',message='checkout_cart_scope_mismatch';
  end if;
  if c.customer_id is distinct from new.customer_id then
    raise exception using errcode='23514',message='checkout_cart_owner_mismatch';
  end if;
  if tg_op='UPDATE' and (new.store_id<>old.store_id or new.cart_id<>old.cart_id or
      new.customer_id is distinct from old.customer_id or new.currency<>old.currency or
      new.idempotency_key<>old.idempotency_key or new.request_hash<>old.request_hash or
      new.cart_version<>old.cart_version or new.correlation_id<>old.correlation_id or
      new.expires_at<>old.expires_at or new.shipping_required<>old.shipping_required) then
    raise exception using errcode='23514',message='checkout_identity_immutable';
  end if;
  return new;
end $$;

create trigger checkout_sessions_validate_cart before insert or update on public.checkout_sessions
for each row execute function public.validate_checkout_session_cart();
create trigger checkout_sessions_set_updated_at before update on public.checkout_sessions
for each row execute function public.set_updated_at();

create function public.enforce_checkout_status_transition()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status=old.status then return new; end if;
  if not ((old.status='open' and new.status in ('validating','expired','cancelled')) or
          (old.status='validating' and new.status in ('ready','expired','cancelled')) or
          (old.status='ready' and new.status in ('submitting','expired','cancelled')) or
          (old.status='submitting' and new.status in ('ready','order_created'))) then
    raise exception using errcode='23514',message='invalid_checkout_status_transition';
  end if;
  new.version=old.version+1;
  return new;
end $$;

create trigger checkout_sessions_status_transition before update of status on public.checkout_sessions
for each row execute function public.enforce_checkout_status_transition();

create function public.enforce_checkout_snapshot_mutability()
returns trigger language plpgsql security invoker set search_path='' as $$
declare s public.checkout_sessions;
begin
  select * into s from public.checkout_sessions where id=coalesce(new.checkout_session_id,old.checkout_session_id);
  if not found or s.status not in ('open','validating') or s.expires_at<=now() then
    raise exception using errcode='23514',message='checkout_snapshot_immutable';
  end if;
  return coalesce(new,old);
end $$;

create trigger checkout_items_mutability before insert or update or delete on public.checkout_session_items
for each row execute function public.enforce_checkout_snapshot_mutability();
create trigger checkout_quotes_mutability before insert or update or delete on public.checkout_shipping_quotes
for each row execute function public.enforce_checkout_snapshot_mutability();

create function public.prepare_native_checkout(
  p_store_id uuid,p_cart_id uuid,p_customer_id uuid,p_guest_fingerprint text,
  p_idempotency_key text,p_request_hash text,p_expected_cart_version bigint,
  p_price_list_id uuid,p_inventory_location_id uuid,p_expires_at timestamptz,
  p_shipping_required boolean,p_quote_key text default null,p_shipping_method_id uuid default null,
  p_provider public.external_system default null,p_external_service_code text default null,
  p_carrier_name text default null,p_service_name text default null,p_shipping_amount_minor bigint default null,
  p_destination_postcode text default null,p_destination_fingerprint text default null,
  p_logistics_fingerprint text default null,p_logistics_version text default null,
  p_quote_expires_at timestamptz default null,p_estimated_delivery_days integer default null,
  p_provider_quote_reference text default null
) returns public.checkout_sessions language plpgsql security definer set search_path='' as $$
declare s public.checkout_sessions; c public.carts; item record; snap public.checkout_session_items;
  effective bigint; line_no integer:=0; price_hash text; source_hash text;
begin
  if p_request_hash !~ '^[0-9a-f]{64}$' or p_expires_at<=now() then
    raise exception using errcode='22023',message='invalid_checkout_request';
  end if;
  select * into s from public.checkout_sessions where store_id=p_store_id and idempotency_key=p_idempotency_key;
  if found then
    if s.request_hash<>p_request_hash then raise exception using errcode='23505',message='checkout_idempotency_payload_conflict'; end if;
    if s.expires_at<=now() or s.status in ('order_created','expired','cancelled') then
      raise exception using errcode='23514',message='checkout_not_reusable';
    end if;
    return s;
  end if;
  select * into c from public.carts where id=p_cart_id for update;
  if not found then raise exception using errcode='P0002',message='cart_not_found'; end if;
  -- A concurrent same-key creator may have committed while this call waited on
  -- the cart lock. Recheck after serialization before interpreting locked state.
  select * into s from public.checkout_sessions where store_id=p_store_id and idempotency_key=p_idempotency_key;
  if found then
    if s.request_hash<>p_request_hash then raise exception using errcode='23505',message='checkout_idempotency_payload_conflict'; end if;
    if s.expires_at<=now() or s.status in ('order_created','expired','cancelled') then
      raise exception using errcode='23514',message='checkout_not_reusable';
    end if;
    return s;
  end if;
  if c.store_id<>p_store_id or c.status<>'active' or c.expires_at<=now() or c.version<>p_expected_cart_version then
    raise exception using errcode='23514',message='cart_not_checkout_ready';
  end if;
  if c.customer_id is distinct from p_customer_id or
     (p_customer_id is null and (p_guest_fingerprint is null or c.guest_token_fingerprint<>p_guest_fingerprint)) or
     (p_customer_id is not null and p_guest_fingerprint is not null) then
    raise exception using errcode='42501',message='checkout_owner_denied';
  end if;
  if not exists(select 1 from public.price_lists where id=p_price_list_id and status='active' and currency=c.currency) then
    raise exception using errcode='23514',message='invalid_price_list_context';
  end if;
  update public.carts set status='locked',version=version+1 where id=c.id;
  insert into public.checkout_sessions(store_id,cart_id,customer_id,status,currency,idempotency_key,request_hash,cart_version,shipping_required,expires_at)
    values(p_store_id,p_cart_id,p_customer_id,'validating',c.currency,p_idempotency_key,p_request_hash,c.version,p_shipping_required,p_expires_at)
    returning * into s;
  for item in
    select ci.product_variant_id,ci.quantity,pv.product_id,pv.sku,p.name,
      pr.id price_id,pr.list_amount_minor,pr.sale_amount_minor,pr.valid_from,pr.valid_to,pr.sale_valid_from,pr.sale_valid_to
    from public.cart_items ci join public.product_variants pv on pv.id=ci.product_variant_id
    join public.products p on p.id=pv.product_id
    join public.prices pr on pr.product_variant_id=pv.id and pr.price_list_id=p_price_list_id
      and pr.status='active' and pr.valid_from<=now() and (pr.valid_to is null or pr.valid_to>now())
    where ci.cart_id=c.id and pv.status='active' and p.status='active'
    order by ci.id
  loop
    line_no:=line_no+1;
    effective:=case when item.sale_amount_minor is not null
      and (item.sale_valid_from is null or item.sale_valid_from<=now())
      and (item.sale_valid_to is null or item.sale_valid_to>now())
      then item.sale_amount_minor else item.list_amount_minor end;
    price_hash:=encode(extensions.digest(concat_ws('|',item.price_id,item.list_amount_minor,item.sale_amount_minor,item.valid_from,item.valid_to,item.sale_valid_from,item.sale_valid_to,c.currency),'sha256'),'hex');
    source_hash:=encode(extensions.digest(concat_ws('|',c.id,c.version,item.product_variant_id,item.quantity,price_hash),'sha256'),'hex');
    insert into public.checkout_session_items(checkout_session_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,
      unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_total_minor,currency,price_id,price_valid_from,price_valid_to,price_fingerprint,source_fingerprint)
    values(s.id,line_no,item.product_id,item.product_variant_id,item.sku,item.name,item.quantity,item.list_amount_minor,effective,effective*item.quantity,effective*item.quantity,c.currency,item.price_id,item.valid_from,item.valid_to,price_hash,source_hash)
    returning * into snap;
    perform public.reserve_inventory((select il.id from public.inventory_levels il where il.product_variant_id=item.product_variant_id and il.inventory_location_id=p_inventory_location_id),
      item.quantity,'checkout_session_item',snap.id::text,concat('checkout:',s.id,':item:',snap.id,':level:',p_inventory_location_id),least(p_expires_at,coalesce(p_quote_expires_at,p_expires_at)),'persi_checkout');
    update public.inventory_reservations set checkout_session_item_id=snap.id
      where idempotency_key=concat('checkout:',s.id,':item:',snap.id,':level:',p_inventory_location_id);
  end loop;
  if line_no=0 or line_no<>(select count(*) from public.cart_items where cart_id=c.id) then
    raise exception using errcode='23514',message='checkout_item_validation_failed';
  end if;
  if p_shipping_required then
    if p_quote_key is null or p_provider is null or p_shipping_amount_minor is null or p_quote_expires_at<=now() then
      raise exception using errcode='23514',message='valid_shipping_quote_required';
    end if;
    insert into public.checkout_shipping_quotes(checkout_session_id,quote_key,shipping_method_id,provider,external_service_code,carrier_name,service_name,amount_minor,currency,
      estimated_delivery_days,destination_postcode,destination_fingerprint,logistics_fingerprint,logistics_version,provider_quote_reference,is_selected,quoted_at,expires_at,selected_at)
    values(s.id,p_quote_key,p_shipping_method_id,p_provider,p_external_service_code,p_carrier_name,p_service_name,p_shipping_amount_minor,c.currency,
      p_estimated_delivery_days,p_destination_postcode,p_destination_fingerprint,p_logistics_fingerprint,p_logistics_version,p_provider_quote_reference,true,now(),p_quote_expires_at,now());
  end if;
  update public.checkout_sessions set status='ready' where id=s.id returning * into s;
  return s;
exception when unique_violation then
  select * into s from public.checkout_sessions where store_id=p_store_id and idempotency_key=p_idempotency_key;
  if found and s.request_hash=p_request_hash and s.expires_at>now() and s.status not in ('order_created','expired','cancelled') then return s; end if;
  if found then raise exception using errcode='23505',message='checkout_idempotency_payload_conflict'; end if;
  raise exception using errcode='23505',message='checkout_idempotency_or_active_cart_conflict';
end $$;

create function public.close_native_checkout(p_checkout_id uuid,p_target public.checkout_session_status)
returns public.checkout_sessions language plpgsql security definer set search_path='' as $$
declare s public.checkout_sessions; r record;
begin
  if p_target not in ('cancelled','expired') then raise exception using errcode='22023',message='invalid_checkout_close_target'; end if;
  select * into s from public.checkout_sessions where id=p_checkout_id for update;
  if not found then raise exception using errcode='P0002',message='checkout_not_found'; end if;
  if s.status in ('cancelled','expired') then return s; end if;
  if s.status in ('submitting','order_created') then raise exception using errcode='23514',message='checkout_cannot_close'; end if;
  if p_target='expired' and s.expires_at>now() then raise exception using errcode='23514',message='checkout_not_expired'; end if;
  for r in select ir.id from public.inventory_reservations ir join public.checkout_session_items i on i.id=ir.checkout_session_item_id where i.checkout_session_id=s.id and ir.status='active' order by ir.id
  loop perform public.release_inventory_reservation(r.id,concat('checkout-close:',s.id,':',r.id),'persi_checkout'); end loop;
  update public.checkout_sessions set status=p_target where id=s.id returning * into s;
  update public.carts set status='active',version=version+1 where id=s.cart_id and status='locked' and version=s.cart_version+1;
  return s;
end $$;

comment on table public.checkout_sessions is 'B.3-C1 dark checkout coordinator. UUID is not an authorization credential.';
comment on table public.checkout_session_items is 'Authoritative PostgreSQL price/item snapshot, mutable only before ready.';
comment on table public.checkout_shipping_quotes is 'Selected quote snapshot independent from shipping_quote_cache.';

alter table public.checkout_sessions enable row level security;
alter table public.checkout_session_items enable row level security;
alter table public.checkout_shipping_quotes enable row level security;
revoke all on public.checkout_sessions,public.checkout_session_items,public.checkout_shipping_quotes from public,anon,authenticated;
revoke all on function public.validate_checkout_session_cart(),public.enforce_checkout_status_transition(),public.enforce_checkout_snapshot_mutability(),
  public.prepare_native_checkout(uuid,uuid,uuid,text,text,text,bigint,uuid,uuid,timestamptz,boolean,text,uuid,public.external_system,text,text,text,bigint,text,text,text,text,timestamptz,integer,text),
  public.close_native_checkout(uuid,public.checkout_session_status) from public,anon,authenticated;
grant select on public.checkout_sessions,public.checkout_session_items,public.checkout_shipping_quotes to persi_app,persi_worker;
grant execute on function public.prepare_native_checkout(uuid,uuid,uuid,text,text,text,bigint,uuid,uuid,timestamptz,boolean,text,uuid,public.external_system,text,text,text,bigint,text,text,text,text,timestamptz,integer,text) to persi_app;
grant execute on function public.close_native_checkout(uuid,public.checkout_session_status) to persi_app,persi_worker;
create policy checkout_sessions_app_select on public.checkout_sessions for select to persi_app using(true);
create policy checkout_sessions_worker_select on public.checkout_sessions for select to persi_worker using(true);
create policy checkout_items_app_select on public.checkout_session_items for select to persi_app using(true);
create policy checkout_items_worker_select on public.checkout_session_items for select to persi_worker using(true);
create policy checkout_quotes_app_select on public.checkout_shipping_quotes for select to persi_app using(true);
create policy checkout_quotes_worker_select on public.checkout_shipping_quotes for select to persi_worker using(true);
