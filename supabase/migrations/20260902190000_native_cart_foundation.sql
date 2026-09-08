-- B.3-B native cart foundation. Dark/unwired: Woo cart remains authoritative.
create type public.cart_status as enum ('active','locked','converted','abandoned','expired','merged');

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  guest_token_fingerprint text,
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  status public.cart_status not null default 'active',
  expires_at timestamptz not null,
  version bigint not null default 0 check (version >= 0),
  merged_into_cart_id uuid references public.carts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carts_expiry_check check (expires_at > created_at),
  constraint carts_guest_fingerprint_check check (
    guest_token_fingerprint is null or guest_token_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint carts_active_owner_check check (
    status not in ('active','locked') or
    ((customer_id is null) <> (guest_token_fingerprint is null))
  ),
  constraint carts_merge_check check (
    (status = 'merged' and merged_into_cart_id is not null and guest_token_fingerprint is null)
    or (status <> 'merged' and merged_into_cart_id is null)
  ),
  constraint carts_no_self_merge_check check (merged_into_cart_id is null or merged_into_cart_id <> id)
);

create unique index carts_guest_token_unique on public.carts(guest_token_fingerprint)
  where guest_token_fingerprint is not null;
create unique index carts_active_customer_unique on public.carts(store_id,customer_id,currency)
  where status = 'active' and customer_id is not null;
create index carts_customer_lookup_idx on public.carts(customer_id,store_id,status,updated_at desc)
  where customer_id is not null;
create index carts_expiration_idx on public.carts(expires_at,id)
  where status in ('active','locked');
create index carts_status_idx on public.carts(store_id,status,updated_at,id);

create trigger carts_set_updated_at before update on public.carts
for each row execute function public.set_updated_at();

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity bigint not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cart_items_variant_unique unique(cart_id,product_variant_id)
);

create index cart_items_variant_idx on public.cart_items(product_variant_id,cart_id);
create trigger cart_items_set_updated_at before update on public.cart_items
for each row execute function public.set_updated_at();

create function public.add_native_cart_item(p_cart_id uuid,p_variant_id uuid,p_quantity bigint)
returns public.cart_items language plpgsql security invoker set search_path=public as $$
declare c public.carts; item public.cart_items;
begin
  if p_quantity <= 0 then raise exception using errcode='23514',message='cart_quantity_must_be_positive'; end if;
  select * into c from carts where id=p_cart_id for update;
  if not found then raise exception using errcode='P0002',message='cart_not_found'; end if;
  if c.status <> 'active' or c.expires_at <= now() then raise exception using errcode='23514',message='cart_not_mutable'; end if;
  insert into cart_items(cart_id,product_variant_id,quantity) values(p_cart_id,p_variant_id,p_quantity)
  on conflict(cart_id,product_variant_id) do update set quantity=cart_items.quantity+excluded.quantity,updated_at=now()
  returning * into item;
  update carts set version=version+1 where id=p_cart_id;
  return item;
end $$;

create function public.set_native_cart_item_quantity(p_cart_id uuid,p_variant_id uuid,p_quantity bigint)
returns public.cart_items language plpgsql security invoker set search_path=public as $$
declare c public.carts; item public.cart_items;
begin
  if p_quantity <= 0 then raise exception using errcode='23514',message='cart_quantity_must_be_positive'; end if;
  select * into c from carts where id=p_cart_id for update;
  if not found then raise exception using errcode='P0002',message='cart_not_found'; end if;
  if c.status <> 'active' or c.expires_at <= now() then raise exception using errcode='23514',message='cart_not_mutable'; end if;
  update cart_items set quantity=p_quantity where cart_id=p_cart_id and product_variant_id=p_variant_id returning * into item;
  if not found then raise exception using errcode='P0002',message='cart_item_not_found'; end if;
  update carts set version=version+1 where id=p_cart_id;
  return item;
end $$;

create function public.remove_native_cart_item(p_cart_id uuid,p_variant_id uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
declare c public.carts; removed boolean;
begin
  select * into c from carts where id=p_cart_id for update;
  if not found then raise exception using errcode='P0002',message='cart_not_found'; end if;
  if c.status <> 'active' or c.expires_at <= now() then raise exception using errcode='23514',message='cart_not_mutable'; end if;
  delete from cart_items where cart_id=p_cart_id and product_variant_id=p_variant_id;
  removed := found; if removed then update carts set version=version+1 where id=p_cart_id; end if;
  return removed;
end $$;

create function public.merge_native_carts(p_guest_cart_id uuid,p_customer_cart_id uuid,p_customer_id uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare g public.carts; t public.carts;
begin
  perform id from carts where id in(p_guest_cart_id,p_customer_cart_id) order by id for update;
  select * into g from carts where id=p_guest_cart_id;
  select * into t from carts where id=p_customer_cart_id;
  if g.status='merged' and g.merged_into_cart_id=p_customer_cart_id then return p_customer_cart_id; end if;
  if g.status<>'active' or g.customer_id is not null or g.guest_token_fingerprint is null then raise exception using errcode='23514',message='invalid_guest_cart'; end if;
  if t.status<>'active' or t.customer_id is distinct from p_customer_id then raise exception using errcode='23514',message='invalid_customer_cart'; end if;
  if g.store_id<>t.store_id or g.currency<>t.currency then raise exception using errcode='23514',message='cart_scope_mismatch'; end if;
  insert into cart_items(cart_id,product_variant_id,quantity)
    select p_customer_cart_id,product_variant_id,quantity from cart_items where cart_id=p_guest_cart_id
    on conflict(cart_id,product_variant_id) do update set quantity=cart_items.quantity+excluded.quantity,updated_at=now();
  update carts set status='merged',guest_token_fingerprint=null,merged_into_cart_id=p_customer_cart_id,version=version+1 where id=p_guest_cart_id;
  update carts set version=version+1 where id=p_customer_cart_id;
  return p_customer_cart_id;
end $$;

comment on table public.carts is 'Native carts are dark/unwired in B.3-B. Guest raw capability tokens are never stored; carts do not reserve stock.';
comment on table public.cart_items is 'Variant and requested quantity only. Price and stock are revalidated server-side; no authoritative price snapshot.';

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
revoke all on public.carts,public.cart_items from public,anon,authenticated;
revoke all on function public.add_native_cart_item(uuid,uuid,bigint),public.set_native_cart_item_quantity(uuid,uuid,bigint),public.remove_native_cart_item(uuid,uuid),public.merge_native_carts(uuid,uuid,uuid) from public,anon,authenticated;
grant select,insert,update on public.carts,public.cart_items to persi_app,persi_worker;
grant delete on public.cart_items to persi_app,persi_worker;
grant execute on function public.add_native_cart_item(uuid,uuid,bigint),public.set_native_cart_item_quantity(uuid,uuid,bigint),public.remove_native_cart_item(uuid,uuid),public.merge_native_carts(uuid,uuid,uuid) to persi_app,persi_worker;
create policy carts_app on public.carts for all to persi_app using(true) with check(true);
create policy carts_worker on public.carts for all to persi_worker using(true) with check(true);
create policy cart_items_app on public.cart_items for all to persi_app using(true) with check(true);
create policy cart_items_worker on public.cart_items for all to persi_worker using(true) with check(true);
