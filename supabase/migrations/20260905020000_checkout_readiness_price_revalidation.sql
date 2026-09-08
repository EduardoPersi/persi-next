-- P3-C-R1C: current authoritative price revalidation before readiness.

create function public.canonical_checkout_price_fingerprint(
  p_price_id uuid,p_list_amount_minor bigint,p_sale_amount_minor bigint,
  p_valid_from timestamptz,p_valid_to timestamptz,p_sale_valid_from timestamptz,
  p_sale_valid_to timestamptz,p_currency char(3)
) returns text language sql immutable parallel safe set search_path='' as $$
  select encode(extensions.digest(concat_ws('|',p_price_id,p_list_amount_minor,p_sale_amount_minor,
    p_valid_from,p_valid_to,p_sale_valid_from,p_sale_valid_to,p_currency),'sha256'),'hex')
$$;

create function public.resolve_checkout_authoritative_price(
  p_product_variant_id uuid,p_price_list_id uuid,p_currency char(3),p_as_of timestamptz
) returns table(
  price_id uuid,list_amount_minor bigint,sale_amount_minor bigint,effective_amount_minor bigint,
  valid_from timestamptz,valid_to timestamptz,sale_valid_from timestamptz,sale_valid_to timestamptz,
  currency char(3),price_fingerprint text
) language plpgsql security definer set search_path='' as $$
declare v_price public.prices;
begin
  if p_as_of is null then raise exception using errcode='22023',message='CHECKOUT_PRICE_AS_OF_REQUIRED'; end if;
  select p.* into v_price from public.prices p
    join public.price_lists pl on pl.id=p.price_list_id
    where p.product_variant_id=p_product_variant_id and p.price_list_id=p_price_list_id
      and p.currency=p_currency and pl.currency=p_currency and pl.status='active' and pl.channel='storefront'
      and p.status='active' and p.valid_from<=p_as_of and (p.valid_to is null or p.valid_to>p_as_of)
    for key share of p;
  if not found then raise exception using errcode='23514',message='CHECKOUT_PRICE_STALE'; end if;
  return query select v_price.id,v_price.list_amount_minor,v_price.sale_amount_minor,
    case when v_price.sale_amount_minor is not null
      and (v_price.sale_valid_from is null or v_price.sale_valid_from<=p_as_of)
      and (v_price.sale_valid_to is null or v_price.sale_valid_to>p_as_of)
      then v_price.sale_amount_minor else v_price.list_amount_minor end,
    v_price.valid_from,v_price.valid_to,v_price.sale_valid_from,v_price.sale_valid_to,v_price.currency,
    public.canonical_checkout_price_fingerprint(v_price.id,v_price.list_amount_minor,v_price.sale_amount_minor,
      v_price.valid_from,v_price.valid_to,v_price.sale_valid_from,v_price.sale_valid_to,v_price.currency);
end $$;

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
  line_no integer:=0; source_hash text; authority record; v_as_of timestamptz:=statement_timestamp();
begin
  if p_request_hash !~ '^[0-9a-f]{64}$' or p_expires_at<=v_as_of then raise exception using errcode='22023',message='invalid_checkout_request'; end if;
  select * into s from public.checkout_sessions where store_id=p_store_id and idempotency_key=p_idempotency_key;
  if found then
    if s.request_hash<>p_request_hash then raise exception using errcode='23505',message='checkout_idempotency_payload_conflict'; end if;
    if s.expires_at<=v_as_of or s.status in ('order_created','expired','cancelled') then raise exception using errcode='23514',message='checkout_not_reusable'; end if;
    return s;
  end if;
  select * into c from public.carts where id=p_cart_id for update;
  if not found then raise exception using errcode='P0002',message='cart_not_found'; end if;
  select * into s from public.checkout_sessions where store_id=p_store_id and idempotency_key=p_idempotency_key;
  if found then
    if s.request_hash<>p_request_hash then raise exception using errcode='23505',message='checkout_idempotency_payload_conflict'; end if;
    if s.expires_at<=v_as_of or s.status in ('order_created','expired','cancelled') then raise exception using errcode='23514',message='checkout_not_reusable'; end if;
    return s;
  end if;
  if c.store_id<>p_store_id or c.status<>'active' or c.expires_at<=v_as_of or c.version<>p_expected_cart_version then raise exception using errcode='23514',message='cart_not_checkout_ready'; end if;
  if c.customer_id is distinct from p_customer_id or
     (p_customer_id is null and (p_guest_fingerprint is null or c.guest_token_fingerprint<>p_guest_fingerprint)) or
     (p_customer_id is not null and p_guest_fingerprint is not null) then raise exception using errcode='42501',message='checkout_owner_denied'; end if;
  select * into authority from public.resolve_store_price_authority(p_store_id,c.currency,'storefront_retail',v_as_of);
  if authority.price_list_id<>p_price_list_id then raise exception using errcode='23514',message='invalid_price_list_context'; end if;
  update public.carts set status='locked',version=version+1 where id=c.id;
  insert into public.checkout_sessions(store_id,cart_id,customer_id,status,currency,idempotency_key,request_hash,cart_version,shipping_required,expires_at,
    store_price_list_assignment_id,store_price_list_assignment_version,price_list_id)
  values(p_store_id,p_cart_id,p_customer_id,'validating',c.currency,p_idempotency_key,p_request_hash,c.version,p_shipping_required,p_expires_at,
    authority.assignment_id,authority.assignment_version,authority.price_list_id) returning * into s;
  for item in select ci.product_variant_id,ci.quantity,pv.product_id,pv.sku,p.name,r.*
    from public.cart_items ci join public.product_variants pv on pv.id=ci.product_variant_id join public.products p on p.id=pv.product_id
    cross join lateral public.resolve_checkout_authoritative_price(pv.id,authority.price_list_id,c.currency,v_as_of) r
    where ci.cart_id=c.id and pv.status='active' and p.status='active' order by ci.id
  loop
    line_no:=line_no+1;
    source_hash:=encode(extensions.digest(concat_ws('|',c.id,c.version,item.product_variant_id,item.quantity,item.price_fingerprint),'sha256'),'hex');
    insert into public.checkout_session_items(checkout_session_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,
      unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_total_minor,currency,price_id,price_valid_from,price_valid_to,price_fingerprint,source_fingerprint)
    values(s.id,line_no,item.product_id,item.product_variant_id,item.sku,item.name,item.quantity,item.list_amount_minor,item.effective_amount_minor,
      item.effective_amount_minor*item.quantity,item.effective_amount_minor*item.quantity,c.currency,item.price_id,item.valid_from,item.valid_to,item.price_fingerprint,source_hash) returning * into snap;
    perform public.reserve_inventory((select il.id from public.inventory_levels il where il.product_variant_id=item.product_variant_id and il.inventory_location_id=p_inventory_location_id),
      item.quantity,'checkout_session_item',snap.id::text,concat('checkout:',s.id,':item:',snap.id,':level:',p_inventory_location_id),least(p_expires_at,coalesce(p_quote_expires_at,p_expires_at)),'persi_checkout');
    update public.inventory_reservations set checkout_session_item_id=snap.id where idempotency_key=concat('checkout:',s.id,':item:',snap.id,':level:',p_inventory_location_id);
  end loop;
  if line_no=0 or line_no<>(select count(*) from public.cart_items where cart_id=c.id) then raise exception using errcode='23514',message='checkout_item_validation_failed'; end if;
  if p_shipping_required then
    if p_quote_key is null or p_provider is null or p_shipping_amount_minor is null or p_quote_expires_at<=v_as_of then raise exception using errcode='23514',message='valid_shipping_quote_required'; end if;
    insert into public.checkout_shipping_quotes(checkout_session_id,quote_key,shipping_method_id,provider,external_service_code,carrier_name,service_name,amount_minor,currency,
      estimated_delivery_days,destination_postcode,destination_fingerprint,logistics_fingerprint,logistics_version,provider_quote_reference,is_selected,quoted_at,expires_at,selected_at)
    values(s.id,p_quote_key,p_shipping_method_id,p_provider,p_external_service_code,p_carrier_name,p_service_name,p_shipping_amount_minor,c.currency,
      p_estimated_delivery_days,p_destination_postcode,p_destination_fingerprint,p_logistics_fingerprint,p_logistics_version,p_provider_quote_reference,true,v_as_of,p_quote_expires_at,v_as_of);
  end if;
  return s;
exception when unique_violation then
  select * into s from public.checkout_sessions where store_id=p_store_id and idempotency_key=p_idempotency_key;
  if found and s.request_hash=p_request_hash and s.expires_at>v_as_of and s.status not in ('order_created','expired','cancelled') then return s; end if;
  if found then raise exception using errcode='23505',message='checkout_idempotency_payload_conflict'; end if;
  raise exception using errcode='23505',message='checkout_idempotency_or_active_cart_conflict';
end $$;

create or replace function public.mark_native_checkout_ready(
  p_checkout_id uuid,p_customer_id uuid,p_guest_fingerprint text,p_expected_version bigint,p_expected_pii_fingerprint text
) returns public.checkout_sessions language plpgsql security definer set search_path='' as $$
declare s public.checkout_sessions; c public.carts; authority record; item_count integer; bad_count integer; quote_count integer;
  v_as_of timestamptz:=statement_timestamp();
begin
  select * into s from public.checkout_sessions where id=p_checkout_id for update;
  if not found then raise exception using errcode='P0002',message='CHECKOUT_NOT_FOUND'; end if;
  if (p_customer_id is not null and (p_guest_fingerprint is not null or s.customer_id is distinct from p_customer_id)) or
     (p_customer_id is null and (p_guest_fingerprint is null or s.customer_id is not null or not exists(select 1 from public.carts x where x.id=s.cart_id and x.store_id=s.store_id and x.guest_token_fingerprint=p_guest_fingerprint))) then raise exception using errcode='42501',message='CHECKOUT_OWNER_DENIED'; end if;
  if s.status='ready' and s.version=p_expected_version+1 and s.pii_fingerprint=p_expected_pii_fingerprint then return s; end if;
  if s.status<>'validating' then raise exception using errcode='23514',message='CHECKOUT_STATE_INVALID'; end if;
  if s.version<>p_expected_version then raise exception using errcode='40001',message='CHECKOUT_VERSION_CONFLICT'; end if;
  if s.expires_at<=v_as_of then raise exception using errcode='23514',message='CHECKOUT_EXPIRED'; end if;
  if s.pii_ciphertext is null or s.pii_fingerprint<>p_expected_pii_fingerprint or s.pii_destination_fingerprint is null or s.pii_expires_at<=v_as_of then raise exception using errcode='23514',message='CHECKOUT_PII_REQUIRED_OR_EXPIRED'; end if;
  select * into c from public.carts where id=s.cart_id for update;
  if not found or c.store_id<>s.store_id or c.status<>'locked' or c.version<>s.cart_version+1 then raise exception using errcode='23514',message='CHECKOUT_CART_STATE_INVALID'; end if;
  select * into authority from public.resolve_store_price_authority(s.store_id,s.currency,'storefront_retail',v_as_of);
  if s.store_price_list_assignment_id is distinct from authority.assignment_id or s.store_price_list_assignment_version is distinct from authority.assignment_version or s.price_list_id is distinct from authority.price_list_id then
    raise exception using errcode='23514',message='CHECKOUT_PRICE_STALE'; end if;
  select count(*),count(*) filter(where r.price_id<>i.price_id or r.currency<>i.currency or r.list_amount_minor<>i.unit_regular_amount_minor
      or r.effective_amount_minor<>i.unit_effective_amount_minor or r.valid_from<>i.price_valid_from or r.valid_to is distinct from i.price_valid_to
      or r.price_fingerprint<>i.price_fingerprint)
    into item_count,bad_count from public.checkout_session_items i
    cross join lateral public.resolve_checkout_authoritative_price(i.product_variant_id,authority.price_list_id,s.currency,v_as_of) r
    where i.checkout_session_id=s.id;
  if item_count=0 or bad_count<>0 then raise exception using errcode='23514',message='CHECKOUT_PRICE_STALE'; end if;
  select count(*) into bad_count from public.checkout_session_items i where i.checkout_session_id=s.id and not exists(
    select 1 from public.inventory_reservations r join public.inventory_levels l on l.id=r.inventory_level_id
    where r.checkout_session_item_id=i.id and r.status='active' and r.expires_at>v_as_of and r.quantity=i.quantity and l.product_variant_id=i.product_variant_id);
  if bad_count<>0 then raise exception using errcode='23514',message='CHECKOUT_RESERVATION_INVALID'; end if;
  if s.shipping_required then
    select count(*) into quote_count from public.checkout_shipping_quotes q where q.checkout_session_id=s.id and q.is_selected and q.expires_at>v_as_of
      and q.destination_fingerprint=s.pii_destination_fingerprint and q.currency=s.currency and length(btrim(q.logistics_fingerprint))=64 and length(btrim(q.logistics_version))>0;
    if quote_count<>1 then raise exception using errcode='23514',message='CHECKOUT_SHIPPING_QUOTE_INVALID'; end if;
  end if;
  update public.checkout_sessions set status='ready' where id=s.id returning * into s;
  return s;
end $$;

revoke all on function public.canonical_checkout_price_fingerprint(uuid,bigint,bigint,timestamptz,timestamptz,timestamptz,timestamptz,char(3)),
  public.resolve_checkout_authoritative_price(uuid,uuid,char(3),timestamptz) from public,anon,authenticated,persi_app,persi_worker,persi_readonly;
comment on function public.resolve_checkout_authoritative_price(uuid,uuid,char(3),timestamptz) is 'Canonical server-only checkout price resolver; callers must supply one trusted transaction as-of.';
comment on function public.mark_native_checkout_ready(uuid,uuid,text,bigint,text) is 'Server-only readiness gate with current authority and immutable price snapshot revalidation.';
