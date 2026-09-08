-- P3-C-R1: keep checkout in validating until server-only readiness validation.

create or replace function public.prepare_native_checkout(
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
  if p_request_hash !~ '^[0-9a-f]{64}$' or p_expires_at<=now() then raise exception using errcode='22023',message='invalid_checkout_request'; end if;
  select * into s from public.checkout_sessions where store_id=p_store_id and idempotency_key=p_idempotency_key;
  if found then
    if s.request_hash<>p_request_hash then raise exception using errcode='23505',message='checkout_idempotency_payload_conflict'; end if;
    if s.expires_at<=now() or s.status in ('order_created','expired','cancelled') then raise exception using errcode='23514',message='checkout_not_reusable'; end if;
    return s;
  end if;
  select * into c from public.carts where id=p_cart_id for update;
  if not found then raise exception using errcode='P0002',message='cart_not_found'; end if;
  select * into s from public.checkout_sessions where store_id=p_store_id and idempotency_key=p_idempotency_key;
  if found then
    if s.request_hash<>p_request_hash then raise exception using errcode='23505',message='checkout_idempotency_payload_conflict'; end if;
    if s.expires_at<=now() or s.status in ('order_created','expired','cancelled') then raise exception using errcode='23514',message='checkout_not_reusable'; end if;
    return s;
  end if;
  if c.store_id<>p_store_id or c.status<>'active' or c.expires_at<=now() or c.version<>p_expected_cart_version then raise exception using errcode='23514',message='cart_not_checkout_ready'; end if;
  if c.customer_id is distinct from p_customer_id or
     (p_customer_id is null and (p_guest_fingerprint is null or c.guest_token_fingerprint<>p_guest_fingerprint)) or
     (p_customer_id is not null and p_guest_fingerprint is not null) then raise exception using errcode='42501',message='checkout_owner_denied'; end if;
  if not exists(select 1 from public.price_lists where id=p_price_list_id and status='active' and currency=c.currency) then raise exception using errcode='23514',message='invalid_price_list_context'; end if;
  update public.carts set status='locked',version=version+1 where id=c.id;
  insert into public.checkout_sessions(store_id,cart_id,customer_id,status,currency,idempotency_key,request_hash,cart_version,shipping_required,expires_at)
    values(p_store_id,p_cart_id,p_customer_id,'validating',c.currency,p_idempotency_key,p_request_hash,c.version,p_shipping_required,p_expires_at) returning * into s;
  for item in select ci.product_variant_id,ci.quantity,pv.product_id,pv.sku,p.name,
      pr.id price_id,pr.list_amount_minor,pr.sale_amount_minor,pr.valid_from,pr.valid_to,pr.sale_valid_from,pr.sale_valid_to
    from public.cart_items ci join public.product_variants pv on pv.id=ci.product_variant_id join public.products p on p.id=pv.product_id
    join public.prices pr on pr.product_variant_id=pv.id and pr.price_list_id=p_price_list_id and pr.status='active'
      and pr.valid_from<=now() and (pr.valid_to is null or pr.valid_to>now())
    where ci.cart_id=c.id and pv.status='active' and p.status='active' order by ci.id
  loop
    line_no:=line_no+1;
    effective:=case when item.sale_amount_minor is not null and (item.sale_valid_from is null or item.sale_valid_from<=now()) and (item.sale_valid_to is null or item.sale_valid_to>now()) then item.sale_amount_minor else item.list_amount_minor end;
    price_hash:=encode(extensions.digest(concat_ws('|',item.price_id,item.list_amount_minor,item.sale_amount_minor,item.valid_from,item.valid_to,item.sale_valid_from,item.sale_valid_to,c.currency),'sha256'),'hex');
    source_hash:=encode(extensions.digest(concat_ws('|',c.id,c.version,item.product_variant_id,item.quantity,price_hash),'sha256'),'hex');
    insert into public.checkout_session_items(checkout_session_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,
      unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_total_minor,currency,price_id,price_valid_from,price_valid_to,price_fingerprint,source_fingerprint)
    values(s.id,line_no,item.product_id,item.product_variant_id,item.sku,item.name,item.quantity,item.list_amount_minor,effective,effective*item.quantity,effective*item.quantity,c.currency,item.price_id,item.valid_from,item.valid_to,price_hash,source_hash) returning * into snap;
    perform public.reserve_inventory((select il.id from public.inventory_levels il where il.product_variant_id=item.product_variant_id and il.inventory_location_id=p_inventory_location_id),
      item.quantity,'checkout_session_item',snap.id::text,concat('checkout:',s.id,':item:',snap.id,':level:',p_inventory_location_id),least(p_expires_at,coalesce(p_quote_expires_at,p_expires_at)),'persi_checkout');
    update public.inventory_reservations set checkout_session_item_id=snap.id where idempotency_key=concat('checkout:',s.id,':item:',snap.id,':level:',p_inventory_location_id);
  end loop;
  if line_no=0 or line_no<>(select count(*) from public.cart_items where cart_id=c.id) then raise exception using errcode='23514',message='checkout_item_validation_failed'; end if;
  if p_shipping_required then
    if p_quote_key is null or p_provider is null or p_shipping_amount_minor is null or p_quote_expires_at<=now() then raise exception using errcode='23514',message='valid_shipping_quote_required'; end if;
    insert into public.checkout_shipping_quotes(checkout_session_id,quote_key,shipping_method_id,provider,external_service_code,carrier_name,service_name,amount_minor,currency,
      estimated_delivery_days,destination_postcode,destination_fingerprint,logistics_fingerprint,logistics_version,provider_quote_reference,is_selected,quoted_at,expires_at,selected_at)
    values(s.id,p_quote_key,p_shipping_method_id,p_provider,p_external_service_code,p_carrier_name,p_service_name,p_shipping_amount_minor,c.currency,
      p_estimated_delivery_days,p_destination_postcode,p_destination_fingerprint,p_logistics_fingerprint,p_logistics_version,p_provider_quote_reference,true,now(),p_quote_expires_at,now());
  end if;
  return s;
exception when unique_violation then
  select * into s from public.checkout_sessions where store_id=p_store_id and idempotency_key=p_idempotency_key;
  if found and s.request_hash=p_request_hash and s.expires_at>now() and s.status not in ('order_created','expired','cancelled') then return s; end if;
  if found then raise exception using errcode='23505',message='checkout_idempotency_payload_conflict'; end if;
  raise exception using errcode='23505',message='checkout_idempotency_or_active_cart_conflict';
end $$;

create function public.replace_native_checkout_shipping_quote(
  p_checkout_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_expected_version bigint,
  p_quote_key text,p_shipping_method_id uuid,p_provider public.external_system,p_external_service_code text,
  p_carrier_name text,p_service_name text,p_amount_minor bigint,p_destination_postcode text,
  p_destination_fingerprint text,p_logistics_fingerprint text,p_logistics_version text,
  p_expires_at timestamptz,p_estimated_delivery_days integer default null,p_provider_quote_reference text default null
) returns public.checkout_shipping_quotes language plpgsql security definer set search_path='' as $$
declare s public.checkout_sessions; q public.checkout_shipping_quotes;
begin
  select * into s from public.checkout_sessions where id=p_checkout_id for update;
  if not found then raise exception using errcode='P0002',message='CHECKOUT_NOT_FOUND'; end if;
  if s.status<>'validating' then raise exception using errcode='23514',message='CHECKOUT_STATE_INVALID'; end if;
  if s.version<>p_expected_version then raise exception using errcode='40001',message='CHECKOUT_VERSION_CONFLICT'; end if;
  if (p_customer_id is not null and (p_guest_fingerprint is not null or s.customer_id is distinct from p_customer_id)) or
     (p_customer_id is null and (p_guest_fingerprint is null or s.customer_id is not null or not exists(select 1 from public.carts c where c.id=s.cart_id and c.store_id=s.store_id and c.guest_token_fingerprint=p_guest_fingerprint))) then
    raise exception using errcode='42501',message='CHECKOUT_OWNER_DENIED'; end if;
  if not s.shipping_required or s.pii_destination_fingerprint is null or s.pii_destination_fingerprint<>p_destination_fingerprint then raise exception using errcode='23514',message='CHECKOUT_DESTINATION_MISMATCH'; end if;
  if p_expires_at<=statement_timestamp() then raise exception using errcode='23514',message='SHIPPING_QUOTE_EXPIRED'; end if;
  delete from public.checkout_shipping_quotes where checkout_session_id=s.id;
  insert into public.checkout_shipping_quotes(checkout_session_id,quote_key,shipping_method_id,provider,external_service_code,carrier_name,service_name,amount_minor,currency,
    estimated_delivery_days,destination_postcode,destination_fingerprint,logistics_fingerprint,logistics_version,provider_quote_reference,is_selected,quoted_at,expires_at,selected_at)
  values(s.id,p_quote_key,p_shipping_method_id,p_provider,p_external_service_code,p_carrier_name,p_service_name,p_amount_minor,s.currency,
    p_estimated_delivery_days,p_destination_postcode,p_destination_fingerprint,p_logistics_fingerprint,p_logistics_version,p_provider_quote_reference,true,statement_timestamp(),p_expires_at,statement_timestamp()) returning * into q;
  return q;
end $$;

create function public.mark_native_checkout_ready(
  p_checkout_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_expected_version bigint,p_expected_pii_fingerprint text
) returns public.checkout_sessions language plpgsql security definer set search_path='' as $$
declare s public.checkout_sessions; c public.carts; authority record; item_count integer; bad_count integer; quote_count integer;
begin
  select * into s from public.checkout_sessions where id=p_checkout_id for update;
  if not found then raise exception using errcode='P0002',message='CHECKOUT_NOT_FOUND'; end if;
  if (p_customer_id is not null and (p_guest_fingerprint is not null or s.customer_id is distinct from p_customer_id)) or
     (p_customer_id is null and (p_guest_fingerprint is null or s.customer_id is not null or not exists(select 1 from public.carts x where x.id=s.cart_id and x.store_id=s.store_id and x.guest_token_fingerprint=p_guest_fingerprint))) then
    raise exception using errcode='42501',message='CHECKOUT_OWNER_DENIED'; end if;
  if s.status='ready' and s.version=p_expected_version+1 and s.pii_fingerprint=p_expected_pii_fingerprint then return s; end if;
  if s.status<>'validating' then raise exception using errcode='23514',message='CHECKOUT_STATE_INVALID'; end if;
  if s.version<>p_expected_version then raise exception using errcode='40001',message='CHECKOUT_VERSION_CONFLICT'; end if;
  if s.expires_at<=statement_timestamp() then raise exception using errcode='23514',message='CHECKOUT_EXPIRED'; end if;
  if s.pii_ciphertext is null or s.pii_fingerprint<>p_expected_pii_fingerprint or s.pii_destination_fingerprint is null or s.pii_expires_at<=statement_timestamp() then raise exception using errcode='23514',message='CHECKOUT_PII_REQUIRED_OR_EXPIRED'; end if;
  select * into c from public.carts where id=s.cart_id for update;
  if not found or c.store_id<>s.store_id or c.status<>'locked' or c.version<>s.cart_version+1 then raise exception using errcode='23514',message='CHECKOUT_CART_STATE_INVALID'; end if;
  select * into authority from public.resolve_store_price_authority(s.store_id,s.currency,'storefront_retail',statement_timestamp());
  select count(*),count(*) filter(where p.price_list_id<>authority.price_list_id or i.currency<>s.currency) into item_count,bad_count
    from public.checkout_session_items i join public.prices p on p.id=i.price_id where i.checkout_session_id=s.id;
  if item_count=0 or bad_count<>0 then raise exception using errcode='23514',message='CHECKOUT_PRICE_SNAPSHOT_INVALID'; end if;
  select count(*) into bad_count from public.checkout_session_items i where i.checkout_session_id=s.id and not exists(
    select 1 from public.inventory_reservations r join public.inventory_levels l on l.id=r.inventory_level_id
    where r.checkout_session_item_id=i.id and r.status='active' and r.expires_at>statement_timestamp()
      and r.quantity=i.quantity and l.product_variant_id=i.product_variant_id);
  if bad_count<>0 then raise exception using errcode='23514',message='CHECKOUT_RESERVATION_INVALID'; end if;
  if s.shipping_required then
    select count(*) into quote_count from public.checkout_shipping_quotes q where q.checkout_session_id=s.id and q.is_selected
      and q.expires_at>statement_timestamp() and q.destination_fingerprint=s.pii_destination_fingerprint
      and q.currency=s.currency and length(btrim(q.logistics_fingerprint))=64 and length(btrim(q.logistics_version))>0;
    if quote_count<>1 then raise exception using errcode='23514',message='CHECKOUT_SHIPPING_QUOTE_INVALID'; end if;
  end if;
  update public.checkout_sessions set status='ready' where id=s.id returning * into s;
  return s;
end $$;

revoke all on function public.replace_native_checkout_shipping_quote(uuid,uuid,text,bigint,text,uuid,public.external_system,text,text,text,bigint,text,text,text,text,timestamptz,integer,text),
  public.mark_native_checkout_ready(uuid,uuid,text,bigint,text) from public,anon,authenticated,persi_worker,persi_readonly;
grant execute on function public.replace_native_checkout_shipping_quote(uuid,uuid,text,bigint,text,uuid,public.external_system,text,text,text,bigint,text,text,text,text,timestamptz,integer,text),
  public.mark_native_checkout_ready(uuid,uuid,text,bigint,text) to persi_app;

comment on function public.mark_native_checkout_ready(uuid,uuid,text,bigint,text) is 'Server-only owner/version checked validating-to-ready gate for P3-C prerequisites.';
