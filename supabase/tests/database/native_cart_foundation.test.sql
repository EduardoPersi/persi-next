begin;
select no_plan();
select has_table('public','carts','carts exists');
select has_table('public','cart_items','cart items exists');
select has_type('public','cart_status','cart status exists');
select col_is_pk('public','carts','id','cart PK');
select col_is_pk('public','cart_items','id','item PK');
select fk_ok('public','carts','store_id','public','stores','id','cart store FK');
select fk_ok('public','carts','customer_id','public','customers','id','cart customer FK');
select fk_ok('public','cart_items','cart_id','public','carts','id','item cart FK');
select fk_ok('public','cart_items','product_variant_id','public','product_variants','id','item variant FK');
select has_index('public','carts','carts_guest_token_unique','guest fingerprint unique');
select has_index('public','carts','carts_active_customer_unique','active customer cart unique');
select has_index('public','carts','carts_customer_lookup_idx','customer lookup indexed');
select has_index('public','carts','carts_expiration_idx','expiration indexed');
select has_index('public','cart_items','cart_items_variant_unique','item identity unique');
select ok((select relrowsecurity from pg_class where oid='public.carts'::regclass),'cart RLS');
select ok((select relrowsecurity from pg_class where oid='public.cart_items'::regclass),'item RLS');
select is((select count(*) from pg_policies where schemaname='public' and tablename in('carts','cart_items') and ('public'=any(roles) or 'anon'=any(roles) or 'authenticated'=any(roles))),0::bigint,'zero browser policies');
select is(has_table_privilege('anon','public.carts','select'),false,'anon read blocked');
select is(has_table_privilege('authenticated','public.cart_items','insert'),false,'authenticated write blocked');
select is(has_table_privilege('persi_readonly','public.carts','select'),false,'readonly cart behavior blocked');
select is(has_table_privilege('persi_app','public.carts','delete'),false,'app cannot delete carts');
select is(to_regprocedure('public.add_native_cart_item(uuid,uuid,text,uuid,bigint)') is not null,true,'owner-bound add signature exists');
select is(to_regprocedure('public.set_native_cart_item_quantity(uuid,uuid,text,uuid,bigint)') is not null,true,'owner-bound set signature exists');
select is(to_regprocedure('public.remove_native_cart_item(uuid,uuid,text,uuid)') is not null,true,'owner-bound remove signature exists');
select is(to_regprocedure('public.merge_native_carts(uuid,uuid,uuid,text)') is not null,true,'owner-bound merge signature exists');
select is((select bool_and(prosecdef and proconfig=array['search_path=""']) from pg_proc where oid in(
  'public.add_native_cart_item(uuid,uuid,text,uuid,bigint)'::regprocedure,
  'public.set_native_cart_item_quantity(uuid,uuid,text,uuid,bigint)'::regprocedure,
  'public.remove_native_cart_item(uuid,uuid,text,uuid)'::regprocedure,
  'public.merge_native_carts(uuid,uuid,uuid,text)'::regprocedure
)),true,'cart mutation API is security definer with empty search path');
select is((select bool_and(pg_get_userbyid(proowner)='postgres') from pg_proc where oid in(
  'public.add_native_cart_item(uuid,uuid,text,uuid,bigint)'::regprocedure,
  'public.set_native_cart_item_quantity(uuid,uuid,text,uuid,bigint)'::regprocedure,
  'public.remove_native_cart_item(uuid,uuid,text,uuid)'::regprocedure,
  'public.merge_native_carts(uuid,uuid,uuid,text)'::regprocedure
)),true,'cart mutation API owner is postgres');
select is(to_regprocedure('public.add_native_cart_item(uuid,uuid,bigint)'),null::regprocedure,'historical add overload absent');
select is(to_regprocedure('public.set_native_cart_item_quantity(uuid,uuid,bigint)'),null::regprocedure,'historical set overload absent');
select is(to_regprocedure('public.remove_native_cart_item(uuid,uuid)'),null::regprocedure,'historical remove overload absent');
select is(to_regprocedure('public.merge_native_carts(uuid,uuid,uuid)'),null::regprocedure,'historical merge overload absent');
select is(has_function_privilege('persi_app','public.add_native_cart_item(uuid,uuid,text,uuid,bigint)','execute'),true,'app executes controlled add');
select is(has_function_privilege('anon','public.add_native_cart_item(uuid,uuid,text,uuid,bigint)','execute'),false,'anon cannot execute controlled add');

insert into stores(id,code,name,status) values
 ('21000000-0000-4000-8000-000000000001','b3b_store_a','Store A','active'),
 ('21000000-0000-4000-8000-000000000002','b3b_store_b','Store B','active');
insert into customers(id,email) values
 ('22000000-0000-4000-8000-000000000001','a@example.invalid'),
 ('22000000-0000-4000-8000-000000000002','b@example.invalid');
insert into products(id,name,slug,status) values('23000000-0000-4000-8000-000000000001','Synthetic B3B','synthetic-b3b','draft');
insert into product_variants(id,product_id,sku,status) values
 ('24000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','B3B-A','draft'),
 ('24000000-0000-4000-8000-000000000002','23000000-0000-4000-8000-000000000001','B3B-B','draft');

select lives_ok($$insert into carts(id,store_id,guest_token_fingerprint,expires_at) values
 ('25000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 day')$$,'guest cart supported');
select lives_ok($$insert into carts(id,store_id,customer_id,expires_at) values
 ('25000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',now()+interval '1 day')$$,'customer cart supported');
select lives_ok($$insert into carts(id,store_id,customer_id,expires_at) values
 ('25000000-0000-4000-8000-000000000003','21000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001',now()+interval '1 day')$$,'same customer supports another store');
select throws_ok($$insert into carts(store_id,guest_token_fingerprint,expires_at) values
 ('21000000-0000-4000-8000-000000000002',repeat('a',64),now()+interval '1 day')$$,'23505',null,'guest fingerprint unique');
select throws_ok($$insert into carts(store_id,customer_id,expires_at) values
 ('21000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001',now()+interval '1 day')$$,'23505',null,'one active customer cart per store/currency');
select throws_ok($$insert into carts(store_id,expires_at) values('21000000-0000-4000-8000-000000000001',now()+interval '1 day')$$,'23514',null,'active owner required');
select throws_ok($$insert into carts(store_id,customer_id,guest_token_fingerprint,expires_at) values('21000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000002',repeat('b',64),now()+interval '1 day')$$,'23514',null,'active cart cannot have two owners');
select throws_ok($$insert into carts(store_id,guest_token_fingerprint,expires_at) values('21000000-0000-4000-8000-000000000001','bad',now()+interval '1 day')$$,'23514',null,'fingerprint format checked');
select throws_ok($$insert into carts(store_id,guest_token_fingerprint,expires_at) values('21000000-0000-4000-8000-000000000001',repeat('b',64),now()-interval '1 day')$$,'23514',null,'expiration consistency checked');
select throws_ok($$insert into carts(store_id,guest_token_fingerprint,currency,expires_at) values('21000000-0000-4000-8000-000000000001',repeat('b',64),'brl',now()+interval '1 day')$$,'23514',null,'currency format checked');
select lives_ok($$select add_native_cart_item('25000000-0000-4000-8000-000000000001',null,repeat('a',64),'24000000-0000-4000-8000-000000000001',2)$$,'add item');
select lives_ok($$select add_native_cart_item('25000000-0000-4000-8000-000000000001',null,repeat('a',64),'24000000-0000-4000-8000-000000000001',3)$$,'same item adds atomically');
select is((select quantity from cart_items where cart_id='25000000-0000-4000-8000-000000000001'),5::bigint,'add quantities summed');
select throws_ok($$select add_native_cart_item('25000000-0000-4000-8000-000000000001',null,repeat('a',64),'24000000-0000-4000-8000-000000000002',0)$$,'23514','CART_QUANTITY_INVALID','zero rejected');
select lives_ok($$select set_native_cart_item_quantity('25000000-0000-4000-8000-000000000001',null,repeat('a',64),'24000000-0000-4000-8000-000000000001',4)$$,'set quantity');
select is((select quantity from cart_items where cart_id='25000000-0000-4000-8000-000000000001'),4::bigint,'set is authoritative');
select is(remove_native_cart_item('25000000-0000-4000-8000-000000000001',null,repeat('a',64),'24000000-0000-4000-8000-000000000001'),true,'remove item');
select is(remove_native_cart_item('25000000-0000-4000-8000-000000000001',null,repeat('a',64),'24000000-0000-4000-8000-000000000001'),false,'remove retry idempotent');
select lives_ok($$select add_native_cart_item('25000000-0000-4000-8000-000000000001',null,repeat('a',64),'24000000-0000-4000-8000-000000000001',2)$$,'guest item for merge');
select lives_ok($$select add_native_cart_item('25000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001',null,'24000000-0000-4000-8000-000000000001',3)$$,'customer item for merge');
select throws_ok($$select add_native_cart_item('25000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000002',repeat('a',64),'24000000-0000-4000-8000-000000000001',1)$$,'42501','CART_OWNERSHIP_INVALID','guest cart rejects supplied wrong customer even with correct fingerprint');
select throws_ok($$select set_native_cart_item_quantity('25000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000002',null,'24000000-0000-4000-8000-000000000001',9)$$,'42501','CART_OWNERSHIP_INVALID','guest cart rejects wrong customer with null fingerprint');
select throws_ok($$select remove_native_cart_item('25000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000002',repeat('b',64),'24000000-0000-4000-8000-000000000001')$$,'42501','CART_OWNERSHIP_INVALID','guest cart rejects wrong customer and fingerprint');
select throws_ok($$select add_native_cart_item('25000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001',repeat('a',64),'24000000-0000-4000-8000-000000000001',1)$$,'42501','CART_OWNERSHIP_INVALID','customer cart rejects guest fingerprint with correct customer');
select is((select quantity from cart_items where cart_id='25000000-0000-4000-8000-000000000001'),2::bigint,'unauthorized attempts preserve guest quantity');
select is((select version from carts where id='25000000-0000-4000-8000-000000000001'),5::bigint,'unauthorized attempts preserve guest version');
select is(merge_native_carts('25000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001',repeat('a',64)),'25000000-0000-4000-8000-000000000002'::uuid,'merge returns target');
select is((select quantity from cart_items where cart_id='25000000-0000-4000-8000-000000000002'),5::bigint,'merge sums requested quantity');
select is((select status::text from carts where id='25000000-0000-4000-8000-000000000001'),'merged','source terminal');
select is((select guest_token_fingerprint from carts where id='25000000-0000-4000-8000-000000000001'),null,'guest capability invalidated');
select is(merge_native_carts('25000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000001',repeat('a',64)),'25000000-0000-4000-8000-000000000002'::uuid,'merge retry idempotent');
select is((select quantity from cart_items where cart_id='25000000-0000-4000-8000-000000000002'),5::bigint,'merge retry does not double quantity');
select throws_ok($$delete from stores where id='21000000-0000-4000-8000-000000000001'$$,'23503',null,'store delete restricted');
select throws_ok($$delete from customers where id='22000000-0000-4000-8000-000000000001'$$,'23503',null,'customer delete restricted');
select throws_ok($$delete from product_variants where id='24000000-0000-4000-8000-000000000001'$$,'23503',null,'variant delete restricted');
set local role anon;
select throws_ok($$select * from carts$$,'42501',null,'anon cart read rejected');
select throws_ok($$insert into carts(store_id,guest_token_fingerprint,expires_at) values('21000000-0000-4000-8000-000000000001',repeat('c',64),now()+interval '1 day')$$,'42501',null,'anon cart write rejected');
reset role;
select * from finish();
rollback;
