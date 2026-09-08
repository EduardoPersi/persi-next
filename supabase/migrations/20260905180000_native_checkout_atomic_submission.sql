-- B.3-C3-P3-C-M29 candidate. LOCAL/OFFLINE ONLY until the explicit M29-C gate.
-- Cart authority hardening and atomic checkout -> pending order submission.

create function public.enforce_native_cart_transition()
returns trigger language plpgsql security invoker set search_path='' as $$
declare changed boolean;
begin
  if new.id<>old.id or new.store_id<>old.store_id or new.currency<>old.currency or
     new.created_at<>old.created_at or new.expires_at<>old.expires_at then
    raise exception using errcode='23514',message='CART_IDENTITY_IMMUTABLE';
  end if;
  changed := row(new.status,new.customer_id,new.guest_token_fingerprint,new.merged_into_cart_id)
    is distinct from row(old.status,old.customer_id,old.guest_token_fingerprint,old.merged_into_cart_id);
  if new.version<old.version or new.version>old.version+1 or (changed and new.version<>old.version+1) then
    raise exception using errcode='40001',message='CART_VERSION_CONFLICT';
  end if;
  if new.status<>old.status and not (
    (old.status='active' and new.status in ('locked','merged')) or
    (old.status='locked' and new.status in ('active','converted'))
  ) then raise exception using errcode='23514',message='CART_TRANSITION_INVALID'; end if;
  if new.customer_id is distinct from old.customer_id then
    raise exception using errcode='23514',message='CART_OWNER_IMMUTABLE';
  end if;
  if old.guest_token_fingerprint is distinct from new.guest_token_fingerprint and not
     (old.status='active' and new.status='merged' and old.guest_token_fingerprint is not null and new.guest_token_fingerprint is null) then
    raise exception using errcode='23514',message='CART_OWNER_IMMUTABLE';
  end if;
  if old.merged_into_cart_id is distinct from new.merged_into_cart_id and not
     (old.status='active' and new.status='merged' and old.merged_into_cart_id is null and new.merged_into_cart_id is not null) then
    raise exception using errcode='23514',message='CART_MERGE_TARGET_INVALID';
  end if;
  return new;
end $$;

create trigger carts_transition_guard before update on public.carts
for each row execute function public.enforce_native_cart_transition();

create function public.enforce_native_cart_item_mutability()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_cart_id uuid; v_cart public.carts;
begin
  if tg_op='UPDATE' and new.cart_id<>old.cart_id then
    raise exception using errcode='23514',message='CART_ITEM_REPARENT_FORBIDDEN';
  end if;
  v_cart_id:=case when tg_op='DELETE' then old.cart_id else new.cart_id end;
  select * into v_cart from public.carts where id=v_cart_id for update;
  if not found then raise exception using errcode='P0002',message='CART_NOT_FOUND'; end if;
  if v_cart.status<>'active' or v_cart.expires_at<=statement_timestamp() then
    raise exception using errcode='23514',message='CART_NOT_MUTABLE';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create trigger cart_items_mutability_guard before insert or update or delete on public.cart_items
for each row execute function public.enforce_native_cart_item_mutability();

create function public.create_native_cart(p_store_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_currency char(3),p_expires_at timestamptz)
returns public.carts language plpgsql security definer set search_path='' as $$
declare c public.carts;
begin
  if (p_customer_id is null)=(p_guest_fingerprint is null) or p_expires_at<=statement_timestamp() then
    raise exception using errcode='22023',message='CART_INPUT_INVALID';
  end if;
  if p_guest_fingerprint is not null and p_guest_fingerprint!~'^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='CART_OWNER_INVALID';
  end if;
  if not exists(select 1 from public.stores s where s.id=p_store_id and s.status='active' and s.default_currency=p_currency) then
    raise exception using errcode='P0002',message='ACTIVE_STORE_NOT_FOUND';
  end if;
  select * into c from public.carts x where x.store_id=p_store_id and x.currency=p_currency and x.status='active' and
    ((p_customer_id is not null and x.customer_id=p_customer_id) or (p_guest_fingerprint is not null and x.guest_token_fingerprint=p_guest_fingerprint)) for update;
  if found then return c; end if;
  begin
    insert into public.carts(store_id,customer_id,guest_token_fingerprint,currency,status,expires_at)
      values(p_store_id,p_customer_id,p_guest_fingerprint,p_currency,'active',p_expires_at) returning * into c;
  exception when unique_violation then
    select * into c from public.carts x where x.store_id=p_store_id and x.currency=p_currency and x.status='active' and
      ((p_customer_id is not null and x.customer_id=p_customer_id) or (p_guest_fingerprint is not null and x.guest_token_fingerprint=p_guest_fingerprint)) for update;
    if not found then raise; end if;
  end;
  return c;
end $$;

create function public.add_native_cart_item(p_cart_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_variant_id uuid,p_quantity bigint)
returns public.cart_items language plpgsql security definer set search_path='' as $$
declare c public.carts; item public.cart_items;
begin
  if p_quantity<=0 then raise exception using errcode='23514',message='CART_QUANTITY_INVALID'; end if;
  select * into c from public.carts where id=p_cart_id for update;
  if not found then raise exception using errcode='P0002',message='CART_NOT_FOUND'; end if;
  if c.status<>'active' or c.expires_at<=statement_timestamp() then raise exception using errcode='23514',message='CART_NOT_MUTABLE'; end if;
  if not ((p_customer_id is not null and p_guest_fingerprint is null and c.customer_id=p_customer_id) or
          (p_customer_id is null and p_guest_fingerprint is not null and c.customer_id is null and c.guest_token_fingerprint=p_guest_fingerprint)) then
    raise exception using errcode='42501',message='CART_OWNERSHIP_INVALID';
  end if;
  insert into public.cart_items(cart_id,product_variant_id,quantity) values(c.id,p_variant_id,p_quantity)
  on conflict(cart_id,product_variant_id) do update set quantity=public.cart_items.quantity+excluded.quantity,updated_at=statement_timestamp()
  returning * into item;
  update public.carts set version=version+1 where id=c.id;
  return item;
end $$;

create function public.set_native_cart_item_quantity(p_cart_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_variant_id uuid,p_quantity bigint)
returns public.cart_items language plpgsql security definer set search_path='' as $$
declare c public.carts; item public.cart_items;
begin
  if p_quantity<=0 then raise exception using errcode='23514',message='CART_QUANTITY_INVALID'; end if;
  select * into c from public.carts where id=p_cart_id for update;
  if not found then raise exception using errcode='P0002',message='CART_NOT_FOUND'; end if;
  if c.status<>'active' or c.expires_at<=statement_timestamp() then raise exception using errcode='23514',message='CART_NOT_MUTABLE'; end if;
  if not ((p_customer_id is not null and p_guest_fingerprint is null and c.customer_id=p_customer_id) or
          (p_customer_id is null and p_guest_fingerprint is not null and c.customer_id is null and c.guest_token_fingerprint=p_guest_fingerprint)) then
    raise exception using errcode='42501',message='CART_OWNERSHIP_INVALID';
  end if;
  update public.cart_items set quantity=p_quantity,updated_at=statement_timestamp()
    where cart_id=c.id and product_variant_id=p_variant_id and quantity<>p_quantity returning * into item;
  if found then update public.carts set version=version+1 where id=c.id; return item; end if;
  select * into item from public.cart_items where cart_id=c.id and product_variant_id=p_variant_id;
  if not found then raise exception using errcode='P0002',message='CART_ITEM_NOT_FOUND'; end if;
  return item;
end $$;

create function public.remove_native_cart_item(p_cart_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_variant_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.carts; removed boolean;
begin
  select * into c from public.carts where id=p_cart_id for update;
  if not found then raise exception using errcode='P0002',message='CART_NOT_FOUND'; end if;
  if c.status<>'active' or c.expires_at<=statement_timestamp() then raise exception using errcode='23514',message='CART_NOT_MUTABLE'; end if;
  if not ((p_customer_id is not null and p_guest_fingerprint is null and c.customer_id=p_customer_id) or
          (p_customer_id is null and p_guest_fingerprint is not null and c.customer_id is null and c.guest_token_fingerprint=p_guest_fingerprint)) then
    raise exception using errcode='42501',message='CART_OWNERSHIP_INVALID';
  end if;
  delete from public.cart_items where cart_id=c.id and product_variant_id=p_variant_id;
  removed:=found;
  if removed then update public.carts set version=version+1 where id=c.id; end if;
  return removed;
end $$;

create function public.merge_native_carts(p_guest_cart_id uuid,p_customer_cart_id uuid,p_customer_id uuid,p_guest_fingerprint text)
returns uuid language plpgsql security definer set search_path='' as $$
declare g public.carts; t public.carts;
begin
  perform id from public.carts where id in(p_guest_cart_id,p_customer_cart_id) order by id for update;
  select * into g from public.carts where id=p_guest_cart_id;
  select * into t from public.carts where id=p_customer_cart_id;
  if g.status='merged' and g.merged_into_cart_id=p_customer_cart_id then return p_customer_cart_id; end if;
  if g.status<>'active' or g.customer_id is not null or g.guest_token_fingerprint is distinct from p_guest_fingerprint then raise exception using errcode='42501',message='CART_OWNERSHIP_INVALID'; end if;
  if t.status<>'active' or t.customer_id is distinct from p_customer_id then raise exception using errcode='42501',message='CART_OWNERSHIP_INVALID'; end if;
  if g.store_id<>t.store_id or g.currency<>t.currency then raise exception using errcode='23514',message='CART_SCOPE_MISMATCH'; end if;
  insert into public.cart_items(cart_id,product_variant_id,quantity)
    select t.id,product_variant_id,quantity from public.cart_items where cart_id=g.id
    on conflict(cart_id,product_variant_id) do update set quantity=public.cart_items.quantity+excluded.quantity,updated_at=statement_timestamp();
  update public.carts set status='merged',guest_token_fingerprint=null,merged_into_cart_id=t.id,version=version+1 where id=g.id;
  update public.carts set version=version+1 where id=t.id;
  return t.id;
end $$;

drop function public.add_native_cart_item(uuid,uuid,bigint);
drop function public.set_native_cart_item_quantity(uuid,uuid,bigint);
drop function public.remove_native_cart_item(uuid,uuid);
drop function public.merge_native_carts(uuid,uuid,uuid);

drop policy if exists carts_app on public.carts;
drop policy if exists carts_worker on public.carts;
drop policy if exists cart_items_app on public.cart_items;
drop policy if exists cart_items_worker on public.cart_items;
revoke insert,update,delete,truncate,references,trigger on public.carts,public.cart_items from persi_app,persi_worker;
grant select on public.carts,public.cart_items to persi_app,persi_worker;
create policy carts_app_select on public.carts for select to persi_app using(true);
create policy carts_worker_select on public.carts for select to persi_worker using(true);
create policy cart_items_app_select on public.cart_items for select to persi_app using(true);
create policy cart_items_worker_select on public.cart_items for select to persi_worker using(true);

alter table public.orders add column submission_request_hash text;
alter table public.orders add constraint orders_submission_request_hash_format
  check(submission_request_hash is null or submission_request_hash~'^[0-9a-f]{64}$');

create or replace function public.enforce_native_order_immutability() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception using errcode='23514',message='order_history_delete_forbidden'; end if;
  if tg_table_name='orders' then
    if new.status=old.status or new.store_id<>old.store_id or new.customer_id is distinct from old.customer_id or new.checkout_session_id is distinct from old.checkout_session_id
      or new.submission_request_hash is distinct from old.submission_request_hash or new.order_sequence<>old.order_sequence or new.order_number<>old.order_number or new.currency<>old.currency
      or new.items_subtotal_minor<>old.items_subtotal_minor or new.discount_total_minor<>old.discount_total_minor or new.shipping_total_minor<>old.shipping_total_minor
      or new.tax_total_minor<>old.tax_total_minor or new.fee_total_minor<>old.fee_total_minor or new.grand_total_minor<>old.grand_total_minor
      or new.contact_name<>old.contact_name or new.contact_email<>old.contact_email or new.contact_phone is distinct from old.contact_phone
      or new.tax_id_type is distinct from old.tax_id_type or new.tax_id_ciphertext is distinct from old.tax_id_ciphertext
      or new.tax_id_fingerprint is distinct from old.tax_id_fingerprint or new.tax_id_masked is distinct from old.tax_id_masked
      or new.correlation_id<>old.correlation_id or new.created_at<>old.created_at then
      raise exception using errcode='23514',message='order_immutable_fields_changed';
    end if;
  else raise exception using errcode='23514',message='order_child_immutable'; end if;
  return new;
end $$;

create function public.canonical_native_checkout_items_fingerprint(p_checkout_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(coalesce(jsonb_agg(jsonb_build_array(
    i.line_number,i.product_id,i.product_variant_id,i.sku_snapshot,i.product_name_snapshot,
    to_jsonb(i.variant_label_snapshot),i.quantity,i.unit_regular_amount_minor,i.unit_effective_amount_minor,
    i.line_subtotal_minor,i.line_discount_minor,i.line_tax_minor,i.line_total_minor,btrim(i.currency),
    i.price_id,i.price_fingerprint,i.source_fingerprint) order by i.line_number,i.id),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')
  from public.checkout_session_items i where i.checkout_session_id=p_checkout_id
$$;

create function public.canonical_native_submission_request_hash(p_checkout_id uuid,p_expected_version bigint)
returns text language plpgsql stable security definer set search_path='' as $$
declare s public.checkout_sessions; q public.checkout_shipping_quotes; e public.checkout_shipping_evidence; v jsonb;
begin
  select * into s from public.checkout_sessions where id=p_checkout_id;
  if not found or s.version<>p_expected_version then raise exception using errcode='40001',message='CHECKOUT_VERSION_CONFLICT'; end if;
  select * into q from public.checkout_shipping_quotes where checkout_session_id=s.id and is_selected;
  if found then select * into e from public.checkout_shipping_evidence where id=q.shipping_evidence_id; end if;
  v:=jsonb_build_array(jsonb_build_array('contract','c3-request-v1'),jsonb_build_array('checkout_id',s.id),
    jsonb_build_array('store_id',s.store_id),jsonb_build_array('cart_id',s.cart_id),jsonb_build_array('cart_version',s.cart_version),
    jsonb_build_array('checkout_version',s.version),jsonb_build_array('idempotency_key',s.idempotency_key),
    jsonb_build_array('assignment_id',to_jsonb(s.store_price_list_assignment_id)),jsonb_build_array('assignment_version',to_jsonb(s.store_price_list_assignment_version)),
    jsonb_build_array('price_list_id',to_jsonb(s.price_list_id)),jsonb_build_array('currency',btrim(s.currency)),
    jsonb_build_array('items_fingerprint',public.canonical_native_checkout_items_fingerprint(s.id)),
    jsonb_build_array('pii_fingerprint',to_jsonb(s.pii_fingerprint)),jsonb_build_array('destination_fingerprint',to_jsonb(s.pii_destination_fingerprint)),
    jsonb_build_array('quote_id',to_jsonb(q.id)),jsonb_build_array('shipping_evidence_id',to_jsonb(e.id)),
    jsonb_build_array('logistics_fingerprint',to_jsonb(q.logistics_fingerprint)),jsonb_build_array('logistics_version',to_jsonb(q.logistics_version)));
  return encode(extensions.digest(convert_to(v::text,'UTF8'),'sha256'),'hex');
end $$;

create function public.submit_native_checkout(
  p_checkout_id uuid,p_expected_version bigint,p_idempotency_key text,p_submission_request_hash text,
  p_customer_id uuid,p_guest_fingerprint text,p_expected_pii_fingerprint text,p_expected_destination_fingerprint text,
  p_order_id uuid,p_correlation_id uuid,p_contact_name text,p_contact_email text,p_contact_phone text,
  p_billing_address jsonb,p_shipping_address jsonb,p_tax_id_type text,p_tax_id_ciphertext text,p_tax_id_fingerprint text,p_tax_id_masked text
) returns table(order_id uuid,order_number text,order_status public.order_status,checkout_status public.checkout_session_status,checkout_version bigint)
language plpgsql security definer set search_path='' as $$
declare s public.checkout_sessions; c public.carts; existing public.orders; q public.checkout_shipping_quotes;
  authority record; alloc record; line public.checkout_session_items; reservation public.inventory_reservations;
  created_item public.order_items; v_hash text; v_now timestamptz:=statement_timestamp(); v_subtotal bigint; v_discount bigint; v_tax bigint; v_shipping bigint:=0;
begin
  if p_submission_request_hash is null or p_submission_request_hash!~'^[0-9a-f]{64}$' or p_order_id is null or p_correlation_id is null then
    raise exception using errcode='22023',message='CHECKOUT_SUBMISSION_INPUT_INVALID';
  end if;
  if p_billing_address is null or jsonb_typeof(p_billing_address)<>'object' or p_shipping_address is null or jsonb_typeof(p_shipping_address)<>'object' then
    raise exception using errcode='22023',message='CHECKOUT_ADDRESS_INVALID';
  end if;
  select * into s from public.checkout_sessions where id=p_checkout_id for update;
  if not found then raise exception using errcode='P0002',message='CHECKOUT_NOT_FOUND'; end if;
  select * into c from public.carts where id=s.cart_id for update;
  if not found then raise exception using errcode='P0002',message='CART_NOT_FOUND'; end if;
  if not ((p_customer_id is not null and p_guest_fingerprint is null and s.customer_id=p_customer_id and c.customer_id=p_customer_id) or
          (p_customer_id is null and p_guest_fingerprint is not null and s.customer_id is null and c.customer_id is null and c.guest_token_fingerprint=p_guest_fingerprint)) then
    raise exception using errcode='42501',message='CHECKOUT_OWNERSHIP_INVALID';
  end if;
  if s.idempotency_key<>p_idempotency_key then raise exception using errcode='23505',message='CHECKOUT_IDEMPOTENCY_CONFLICT'; end if;
  select * into existing from public.orders where checkout_session_id=s.id;
  if found then
    if existing.submission_request_hash<>p_submission_request_hash then raise exception using errcode='23505',message='CHECKOUT_IDEMPOTENCY_CONFLICT'; end if;
    return query select existing.id,existing.order_number,existing.status,s.status,s.version; return;
  end if;
  if s.status<>'ready' then raise exception using errcode='23514',message='CHECKOUT_NOT_READY'; end if;
  if s.version<>p_expected_version then raise exception using errcode='40001',message='CHECKOUT_VERSION_CONFLICT'; end if;
  if s.expires_at<=v_now then raise exception using errcode='23514',message='CHECKOUT_EXPIRED'; end if;
  if s.pii_ciphertext is null or s.pii_expires_at<=v_now or s.pii_fingerprint<>p_expected_pii_fingerprint or s.pii_destination_fingerprint<>p_expected_destination_fingerprint then
    raise exception using errcode='23514',message='CHECKOUT_PII_STALE';
  end if;
  if c.status<>'locked' or c.version<>s.cart_version+1 or c.store_id<>s.store_id or c.currency<>s.currency then
    raise exception using errcode='23514',message='CHECKOUT_CART_STALE';
  end if;
  if exists(select 1 from public.cart_items ci full join public.checkout_session_items i on i.checkout_session_id=s.id and i.product_variant_id=ci.product_variant_id
    where ci.cart_id=c.id and (ci.id is null or i.id is null or ci.quantity<>i.quantity)) then
    raise exception using errcode='23514',message='CHECKOUT_CART_STALE';
  end if;
  select * into authority from public.resolve_store_price_authority(s.store_id,s.currency,'storefront_retail',v_now);
  if authority.assignment_id is distinct from s.store_price_list_assignment_id or authority.assignment_version is distinct from s.store_price_list_assignment_version or authority.price_list_id is distinct from s.price_list_id then
    raise exception using errcode='23514',message='CHECKOUT_PRICE_STALE';
  end if;
  perform 1 from public.price_lists where id=s.price_list_id for key share;
  if exists(select 1 from public.checkout_session_items i cross join lateral public.resolve_checkout_authoritative_price(i.product_variant_id,s.price_list_id,s.currency,v_now) p
    where i.checkout_session_id=s.id and (p.price_id<>i.price_id or p.list_amount_minor<>i.unit_regular_amount_minor or p.effective_amount_minor<>i.unit_effective_amount_minor or p.price_fingerprint<>i.price_fingerprint)) then
    raise exception using errcode='23514',message='CHECKOUT_PRICE_STALE';
  end if;
  if s.shipping_required then
    if not public.r1d_shipping_quote_is_authoritative(s.id,s.store_id,s.currency,s.pii_destination_fingerprint,v_now) then raise exception using errcode='23514',message='CHECKOUT_SHIPPING_QUOTE_INVALID'; end if;
    select * into q from public.checkout_shipping_quotes where checkout_session_id=s.id and is_selected for key share;
    perform 1 from public.checkout_shipping_evidence where id=q.shipping_evidence_id for key share;
    v_shipping:=q.amount_minor;
  elsif exists(select 1 from public.checkout_shipping_quotes where checkout_session_id=s.id and is_selected) then
    raise exception using errcode='23514',message='CHECKOUT_SHIPPING_QUOTE_INVALID';
  end if;
  for reservation in select r.* from public.inventory_reservations r join public.checkout_session_items i on i.id=r.checkout_session_item_id
    where i.checkout_session_id=s.id order by i.line_number,r.id for update of r loop
    if reservation.status<>'active' or reservation.expires_at<=v_now or reservation.order_item_id is not null then raise exception using errcode='23514',message=case when reservation.expires_at<=v_now then 'CHECKOUT_RESERVATION_EXPIRED' else 'CHECKOUT_RESERVATION_INVALID' end; end if;
  end loop;
  if exists(select 1 from public.checkout_session_items i where i.checkout_session_id=s.id and
    (select count(*) from public.inventory_reservations r where r.checkout_session_item_id=i.id and r.status='active' and r.expires_at>v_now and r.quantity=i.quantity)<>1) then
    raise exception using errcode='23514',message='CHECKOUT_RESERVATION_INVALID';
  end if;
  perform l.id from public.inventory_levels l join public.inventory_reservations r on r.inventory_level_id=l.id join public.checkout_session_items i on i.id=r.checkout_session_item_id where i.checkout_session_id=s.id order by i.line_number,l.id for key share of l;
  v_hash:=public.canonical_native_submission_request_hash(s.id,s.version);
  if v_hash<>p_submission_request_hash then raise exception using errcode='23505',message='CHECKOUT_IDEMPOTENCY_CONFLICT'; end if;
  if num_nonnulls(p_tax_id_type,p_tax_id_ciphertext,p_tax_id_fingerprint,p_tax_id_masked) not in (0,4) or
     (p_tax_id_ciphertext is not null and p_tax_id_ciphertext=s.pii_ciphertext) then raise exception using errcode='23514',message='ORDER_TAX_BUNDLE_INVALID'; end if;
  update public.checkout_sessions set status='submitting' where id=s.id returning * into s;
  select * into alloc from public.allocate_native_order_number(s.store_id);
  select coalesce(sum(line_subtotal_minor),0),coalesce(sum(line_discount_minor),0),coalesce(sum(line_tax_minor),0)
    into v_subtotal,v_discount,v_tax from public.checkout_session_items where checkout_session_id=s.id;
  insert into public.orders(id,store_id,customer_id,checkout_session_id,submission_request_hash,order_sequence,order_number,status,currency,
    items_subtotal_minor,discount_total_minor,shipping_total_minor,tax_total_minor,fee_total_minor,grand_total_minor,
    contact_name,contact_email,contact_phone,tax_id_type,tax_id_ciphertext,tax_id_fingerprint,tax_id_masked,correlation_id)
  values(p_order_id,s.store_id,s.customer_id,s.id,v_hash,alloc.order_sequence,alloc.order_number,'pending',s.currency,
    v_subtotal,v_discount,v_shipping,v_tax,0,v_subtotal-v_discount+v_shipping+v_tax,btrim(p_contact_name),lower(btrim(p_contact_email)),p_contact_phone,
    p_tax_id_type,p_tax_id_ciphertext,p_tax_id_fingerprint,p_tax_id_masked,p_correlation_id) returning * into existing;
  for line in select * from public.checkout_session_items where checkout_session_id=s.id order by line_number,id loop
    insert into public.order_items(order_id,line_number,product_id,product_variant_id,sku_snapshot,gtin_snapshot,product_name_snapshot,variant_label_snapshot,
      quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint)
    values(existing.id,line.line_number,line.product_id,line.product_variant_id,line.sku_snapshot,null,line.product_name_snapshot,line.variant_label_snapshot,
      line.quantity,line.unit_regular_amount_minor,line.unit_effective_amount_minor,line.line_subtotal_minor,line.line_discount_minor,line.line_tax_minor,line.line_total_minor,line.currency,line.source_fingerprint)
    returning * into created_item;
    select * into reservation from public.inventory_reservations r where r.checkout_session_item_id=line.id for update;
    perform public.link_inventory_reservation_to_order_item(reservation.id,created_item.id);
  end loop;
  insert into public.order_addresses(order_id,address_type,source_customer_address_id,recipient,company,street,number,complement,neighborhood,city,state,postal_code,country)
  select existing.id,x.kind::public.order_address_type,null,btrim(x.body->>'recipient'),nullif(btrim(x.body->>'company'),''),btrim(x.body->>'street'),btrim(x.body->>'number'),nullif(btrim(x.body->>'complement'),''),btrim(x.body->>'neighborhood'),btrim(x.body->>'city'),upper(x.body->>'state'),x.body->>'postal_code',upper(coalesce(x.body->>'country','BR'))
  from (values('billing',p_billing_address),('shipping',p_shipping_address)) x(kind,body);
  insert into public.order_status_events(order_id,from_status,to_status,actor_type,reason_code,correlation_id)
    values(existing.id,null,'pending','system','native_checkout_submitted',p_correlation_id);
  if not public.validate_native_order_totals(existing.id) then raise exception using errcode='23514',message='ORDER_TOTAL_INVALID'; end if;
  set constraints public.orders_initial_event_required,public.order_events_initial_exact immediate;
  update public.checkout_sessions set status='order_created' where id=s.id returning * into s;
  update public.carts set status='converted',version=version+1 where id=c.id;
  perform * from public.clear_checkout_pii(s.id,p_customer_id,p_guest_fingerprint,s.version);
  select * into s from public.checkout_sessions where id=s.id;
  return query select existing.id,existing.order_number,existing.status,s.status,s.version;
end $$;

alter function public.enforce_native_cart_transition() owner to postgres;
alter function public.enforce_native_cart_item_mutability() owner to postgres;
alter function public.create_native_cart(uuid,uuid,text,char,timestamptz) owner to postgres;
alter function public.add_native_cart_item(uuid,uuid,text,uuid,bigint) owner to postgres;
alter function public.set_native_cart_item_quantity(uuid,uuid,text,uuid,bigint) owner to postgres;
alter function public.remove_native_cart_item(uuid,uuid,text,uuid) owner to postgres;
alter function public.merge_native_carts(uuid,uuid,uuid,text) owner to postgres;
alter function public.canonical_native_checkout_items_fingerprint(uuid) owner to postgres;
alter function public.canonical_native_submission_request_hash(uuid,bigint) owner to postgres;
alter function public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text) owner to postgres;

revoke all on function public.enforce_native_cart_transition(),public.enforce_native_cart_item_mutability(),
  public.create_native_cart(uuid,uuid,text,char,timestamptz),public.add_native_cart_item(uuid,uuid,text,uuid,bigint),
  public.set_native_cart_item_quantity(uuid,uuid,text,uuid,bigint),public.remove_native_cart_item(uuid,uuid,text,uuid),
  public.merge_native_carts(uuid,uuid,uuid,text),public.canonical_native_checkout_items_fingerprint(uuid),
  public.canonical_native_submission_request_hash(uuid,bigint),
  public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)
from public,anon,authenticated,persi_app,persi_worker,persi_readonly;
grant execute on function public.create_native_cart(uuid,uuid,text,char,timestamptz),
  public.add_native_cart_item(uuid,uuid,text,uuid,bigint),public.set_native_cart_item_quantity(uuid,uuid,text,uuid,bigint),
  public.remove_native_cart_item(uuid,uuid,text,uuid),public.merge_native_carts(uuid,uuid,uuid,text),
  public.canonical_native_submission_request_hash(uuid,bigint),
  public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)
to persi_app;

comment on column public.orders.submission_request_hash is 'Immutable c3-request-v1 hash; mandatory for orders created by submit_native_checkout.';
comment on function public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text) is 'Server-only atomic ready-checkout to pending-order boundary; no payment, stock confirmation, publication, or external integration.';
