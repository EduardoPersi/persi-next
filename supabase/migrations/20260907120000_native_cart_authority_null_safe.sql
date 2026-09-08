-- M30: fail closed when nullable cart authority inputs are evaluated.

create or replace function public.add_native_cart_item(p_cart_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_variant_id uuid,p_quantity bigint)
returns public.cart_items language plpgsql security definer set search_path='' as $$
declare c public.carts; item public.cart_items; authorized boolean;
begin
  if p_quantity<=0 then raise exception using errcode='23514',message='CART_QUANTITY_INVALID'; end if;
  select * into c from public.carts where id=p_cart_id for update;
  if not found then raise exception using errcode='P0002',message='CART_NOT_FOUND'; end if;
  if c.status<>'active' or c.expires_at<=statement_timestamp() then raise exception using errcode='23514',message='CART_NOT_MUTABLE'; end if;
  authorized := case
    when c.customer_id is not null then p_customer_id is not distinct from c.customer_id and p_guest_fingerprint is null
    else p_customer_id is null and c.guest_token_fingerprint is not null
      and p_guest_fingerprint is not distinct from c.guest_token_fingerprint
  end;
  if authorized is not true then raise exception using errcode='42501',message='CART_OWNERSHIP_INVALID'; end if;
  insert into public.cart_items(cart_id,product_variant_id,quantity) values(c.id,p_variant_id,p_quantity)
  on conflict(cart_id,product_variant_id) do update set quantity=public.cart_items.quantity+excluded.quantity,updated_at=statement_timestamp()
  returning * into item;
  update public.carts set version=version+1 where id=c.id;
  return item;
end $$;

create or replace function public.set_native_cart_item_quantity(p_cart_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_variant_id uuid,p_quantity bigint)
returns public.cart_items language plpgsql security definer set search_path='' as $$
declare c public.carts; item public.cart_items; authorized boolean;
begin
  if p_quantity<=0 then raise exception using errcode='23514',message='CART_QUANTITY_INVALID'; end if;
  select * into c from public.carts where id=p_cart_id for update;
  if not found then raise exception using errcode='P0002',message='CART_NOT_FOUND'; end if;
  if c.status<>'active' or c.expires_at<=statement_timestamp() then raise exception using errcode='23514',message='CART_NOT_MUTABLE'; end if;
  authorized := case
    when c.customer_id is not null then p_customer_id is not distinct from c.customer_id and p_guest_fingerprint is null
    else p_customer_id is null and c.guest_token_fingerprint is not null
      and p_guest_fingerprint is not distinct from c.guest_token_fingerprint
  end;
  if authorized is not true then raise exception using errcode='42501',message='CART_OWNERSHIP_INVALID'; end if;
  update public.cart_items set quantity=p_quantity,updated_at=statement_timestamp()
    where cart_id=c.id and product_variant_id=p_variant_id and quantity<>p_quantity returning * into item;
  if found then update public.carts set version=version+1 where id=c.id; return item; end if;
  select * into item from public.cart_items where cart_id=c.id and product_variant_id=p_variant_id;
  if not found then raise exception using errcode='P0002',message='CART_ITEM_NOT_FOUND'; end if;
  return item;
end $$;

create or replace function public.remove_native_cart_item(p_cart_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_variant_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.carts; removed boolean; authorized boolean;
begin
  select * into c from public.carts where id=p_cart_id for update;
  if not found then raise exception using errcode='P0002',message='CART_NOT_FOUND'; end if;
  if c.status<>'active' or c.expires_at<=statement_timestamp() then raise exception using errcode='23514',message='CART_NOT_MUTABLE'; end if;
  authorized := case
    when c.customer_id is not null then p_customer_id is not distinct from c.customer_id and p_guest_fingerprint is null
    else p_customer_id is null and c.guest_token_fingerprint is not null
      and p_guest_fingerprint is not distinct from c.guest_token_fingerprint
  end;
  if authorized is not true then raise exception using errcode='42501',message='CART_OWNERSHIP_INVALID'; end if;
  delete from public.cart_items where cart_id=c.id and product_variant_id=p_variant_id;
  removed:=found;
  if removed then update public.carts set version=version+1 where id=c.id; end if;
  return removed;
end $$;
