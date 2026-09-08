begin;
select no_plan();
select has_type('public','checkout_session_status','checkout status enum');
select has_table('public','checkout_sessions','checkout sessions exists');
select has_table('public','checkout_session_items','checkout items exists');
select has_table('public','checkout_shipping_quotes','checkout quotes exists');
select col_is_pk('public','checkout_sessions','id','session PK');
select col_is_pk('public','checkout_session_items','id','item PK');
select col_is_pk('public','checkout_shipping_quotes','id','quote PK');
select fk_ok('public','checkout_sessions','store_id','public','stores','id','store FK');
select fk_ok('public','checkout_sessions','customer_id','public','customers','id','customer FK');
select fk_ok('public','checkout_session_items','product_id','public','products','id','product FK');
select fk_ok('public','checkout_session_items','product_variant_id','public','product_variants','id','variant FK');
select fk_ok('public','checkout_session_items','price_id','public','prices','id','price FK');
select fk_ok('public','checkout_shipping_quotes','shipping_method_id','public','shipping_methods','id','shipping method FK');
select fk_ok('public','inventory_reservations','checkout_session_item_id','public','checkout_session_items','id','reservation owner FK');
select has_index('public','checkout_sessions','checkout_sessions_store_idempotency_unique','idempotency indexed');
select has_index('public','checkout_sessions','checkout_sessions_active_cart_unique','active cart indexed');
select has_index('public','checkout_sessions','checkout_sessions_expiration_idx','expiry indexed');
select has_index('public','checkout_session_items','checkout_session_items_variant_unique','snapshot variant indexed');
select has_index('public','checkout_shipping_quotes','checkout_shipping_quotes_selected_unique','selected quote unique');
select has_index('public','inventory_reservations','inventory_reservations_checkout_item_level_unique','reservation owner unique');
select ok((select relrowsecurity from pg_class where oid='public.checkout_sessions'::regclass),'session RLS');
select ok((select relrowsecurity from pg_class where oid='public.checkout_session_items'::regclass),'items RLS');
select ok((select relrowsecurity from pg_class where oid='public.checkout_shipping_quotes'::regclass),'quotes RLS');
select is((select count(*) from pg_policies where schemaname='public' and tablename like 'checkout_%' and ('public'=any(roles) or 'anon'=any(roles) or 'authenticated'=any(roles))),0::bigint,'zero browser policies');
select is(has_table_privilege('anon','public.checkout_sessions','select'),false,'anon blocked');
select is(has_table_privilege('authenticated','public.checkout_session_items','select'),false,'authenticated blocked');
select is(has_table_privilege('persi_readonly','public.checkout_shipping_quotes','select'),false,'readonly blocked');
select is(has_table_privilege('persi_app','public.checkout_sessions','delete'),false,'app delete blocked');
select is((select prosecdef from pg_proc where oid='public.prepare_native_checkout(uuid,uuid,uuid,text,text,text,bigint,uuid,uuid,timestamptz,boolean,text,uuid,external_system,text,text,text,bigint,text,text,text,text,timestamptz,integer,text)'::regprocedure),true,'prepare is narrowly privileged');
select is(has_function_privilege('anon','public.prepare_native_checkout(uuid,uuid,uuid,text,text,text,bigint,uuid,uuid,timestamptz,boolean,text,uuid,external_system,text,text,text,bigint,text,text,text,text,timestamptz,integer,text)','execute'),false,'anon cannot prepare');

insert into stores(id,code,name,status) values
 ('31000000-0000-4000-8000-000000000001','c1_store_a','C1 Store A','active'),
 ('31000000-0000-4000-8000-000000000002','c1_store_b','C1 Store B','active');
insert into customers(id,email) values
 ('32000000-0000-4000-8000-000000000001','c1a@example.invalid'),
 ('32000000-0000-4000-8000-000000000002','c1b@example.invalid');
insert into products(id,name,slug,status,published_at) values
 ('33000000-0000-4000-8000-000000000001','Synthetic C1 A','synthetic-c1-a','active',now()),
 ('33000000-0000-4000-8000-000000000002','Synthetic C1 B','synthetic-c1-b','active',now());
insert into product_variants(id,product_id,sku,status) values
 ('34000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','C1-A','active'),
 ('34000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000002','C1-B','active');
insert into price_lists(id,code,name,currency,channel,status) values('35000000-0000-4000-8000-000000000001','c1_prices','C1 Prices','BRL','storefront','active');
insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values
 ('31000000-0000-4000-8000-000000000001','35000000-0000-4000-8000-000000000001','BRL','storefront_retail',1,now()-interval '1 day');
insert into prices(id,product_variant_id,price_list_id,list_amount_minor,sale_amount_minor,currency,valid_from,sale_valid_from,sale_valid_to) values
 ('36000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','35000000-0000-4000-8000-000000000001',2000,1500,'BRL',now()-interval '1 hour',now()-interval '1 hour',now()+interval '1 day'),
 ('36000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000002','35000000-0000-4000-8000-000000000001',3000,null,'BRL',now()-interval '1 hour',null,null);
insert into inventory_locations(id,code,name,status) values('37000000-0000-4000-8000-000000000001','c1_location','C1 Location','active');
insert into inventory_levels(id,product_variant_id,inventory_location_id,quantity_on_hand) values
 ('38000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','37000000-0000-4000-8000-000000000001',10),
 ('38000000-0000-4000-8000-000000000002','34000000-0000-4000-8000-000000000002','37000000-0000-4000-8000-000000000001',0);
insert into shipping_methods(id,provider,external_code,carrier_name,service_name,status) values
 ('39000000-0000-4000-8000-000000000001','melhor_envio','c1-service','Carrier C1','Service C1','active');
insert into carts(id,store_id,guest_token_fingerprint,expires_at) values
 ('3a000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 day');
insert into cart_items(cart_id,product_variant_id,quantity) values
 ('3a000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001',2);

select lives_ok($$select prepare_native_checkout(
 p_store_id=>'31000000-0000-4000-8000-000000000001',p_cart_id=>'3a000000-0000-4000-8000-000000000001',p_customer_id=>null,p_guest_fingerprint=>repeat('a',64),
 p_idempotency_key=>'c1-idempotency-0001',p_request_hash=>repeat('1',64),p_expected_cart_version=>0,p_price_list_id=>'35000000-0000-4000-8000-000000000001',
 p_inventory_location_id=>'37000000-0000-4000-8000-000000000001',p_expires_at=>now()+interval '30 minutes',p_shipping_required=>true,
 p_quote_key=>'quote-1',p_shipping_method_id=>'39000000-0000-4000-8000-000000000001',p_provider=>'melhor_envio',p_external_service_code=>'c1-service',
 p_carrier_name=>'Carrier C1',p_service_name=>'Service C1',p_shipping_amount_minor=>999,p_destination_postcode=>'13201000',p_destination_fingerprint=>repeat('2',64),
 p_logistics_fingerprint=>repeat('3',64),p_logistics_version=>'v1',p_quote_expires_at=>now()+interval '20 minutes',p_estimated_delivery_days=>2)$$,'prepare checkout');
select is((select status::text from checkout_sessions where cart_id='3a000000-0000-4000-8000-000000000001'),'validating','prepare leaves an explicit validation window');
select is((select status::text from carts where id='3a000000-0000-4000-8000-000000000001'),'locked','cart locked');
select is((select unit_effective_amount_minor from checkout_session_items where checkout_session_id=(select id from checkout_sessions where cart_id='3a000000-0000-4000-8000-000000000001')),1500::bigint,'active sale selected');
select is((select line_subtotal_minor from checkout_session_items where checkout_session_id=(select id from checkout_sessions where cart_id='3a000000-0000-4000-8000-000000000001')),3000::bigint,'money arithmetic');
select is((select quantity_reserved from inventory_levels where id='38000000-0000-4000-8000-000000000001'),2::bigint,'inventory reserved');
select is((select count(*) from inventory_reservations where checkout_session_item_id is not null),1::bigint,'reservation linked');
select is((select count(*) from checkout_shipping_quotes where is_selected),1::bigint,'selected quote snapshot');
select is((select count(*) from shipping_quote_cache),0::bigint,'quote cache not authority');
select lives_ok($$select prepare_native_checkout(
 p_store_id=>'31000000-0000-4000-8000-000000000001',p_cart_id=>'3a000000-0000-4000-8000-000000000001',p_customer_id=>null,p_guest_fingerprint=>repeat('a',64),
 p_idempotency_key=>'c1-idempotency-0001',p_request_hash=>repeat('1',64),p_expected_cart_version=>0,p_price_list_id=>'35000000-0000-4000-8000-000000000001',
 p_inventory_location_id=>'37000000-0000-4000-8000-000000000001',p_expires_at=>now()+interval '30 minutes',p_shipping_required=>false)$$,'same key retry');
select is((select count(*) from checkout_sessions),1::bigint,'retry has one session');
select is((select count(*) from inventory_reservations),1::bigint,'retry has one reservation');
select throws_ok($$select prepare_native_checkout(
 p_store_id=>'31000000-0000-4000-8000-000000000001',p_cart_id=>'3a000000-0000-4000-8000-000000000001',p_customer_id=>null,p_guest_fingerprint=>repeat('a',64),
 p_idempotency_key=>'c1-idempotency-0001',p_request_hash=>repeat('9',64),p_expected_cart_version=>0,p_price_list_id=>'35000000-0000-4000-8000-000000000001',
 p_inventory_location_id=>'37000000-0000-4000-8000-000000000001',p_expires_at=>now()+interval '30 minutes',p_shipping_required=>false)$$,'23505','checkout_idempotency_payload_conflict','hash conflict');
update checkout_sessions set status='ready' where cart_id='3a000000-0000-4000-8000-000000000001';
select throws_ok($$update checkout_session_items set quantity=3 where checkout_session_id=(select id from checkout_sessions limit 1)$$,'23514','checkout_snapshot_immutable','ready item immutable');
select throws_ok($$update checkout_shipping_quotes set amount_minor=1 where checkout_session_id=(select id from checkout_sessions limit 1)$$,'23514','checkout_snapshot_immutable','ready quote immutable');
select lives_ok($$select close_native_checkout((select id from checkout_sessions limit 1),'cancelled')$$,'cancel checkout');
select is((select status::text from checkout_sessions limit 1),'cancelled','checkout terminal');
select is((select status::text from carts where id='3a000000-0000-4000-8000-000000000001'),'active','cart safely unlocked');
select is((select quantity_reserved from inventory_levels where id='38000000-0000-4000-8000-000000000001'),0::bigint,'reservation released');
select is((select status::text from inventory_reservations limit 1),'released','reservation terminal');
select lives_ok($$select close_native_checkout((select id from checkout_sessions limit 1),'cancelled')$$,'cancel retry idempotent');
select throws_ok($$update checkout_sessions set status='ready' where status='cancelled'$$,'23514','invalid_checkout_status_transition','terminal does not reopen');
select throws_ok($$insert into checkout_sessions(store_id,cart_id,customer_id,currency,idempotency_key,request_hash,cart_version,expires_at) values
 ('31000000-0000-4000-8000-000000000002','3a000000-0000-4000-8000-000000000001',null,'BRL','cross-store-0000001',repeat('4',64),2,now()+interval '1 hour')$$,'23514','checkout_cart_scope_mismatch','cross-store rejected');
select throws_ok($$insert into checkout_session_items(checkout_session_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_total_minor,currency,price_id,price_valid_from,price_fingerprint,source_fingerprint)
 values((select id from checkout_sessions limit 1),2,'33000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001','X','X',2,100,100,199,199,'BRL','36000000-0000-4000-8000-000000000001',now(),repeat('5',64),repeat('6',64))$$,'23514',null,'subtotal consistency');
select * from finish();
rollback;
