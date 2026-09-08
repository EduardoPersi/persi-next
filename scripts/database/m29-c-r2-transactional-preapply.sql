\set ON_ERROR_STOP on
\set VERBOSITY verbose
begin;
create extension if not exists pgtap with schema extensions;
\ir ../../supabase/migrations/20260905180000_native_checkout_atomic_submission.sql
select extensions.no_plan();
select extensions.is((select count(*) from pg_policies where schemaname='public' and tablename in('carts','cart_items') and cmd='ALL'),0::bigint,'no ALL policies');
select extensions.is((select count(*) from pg_policies where schemaname='public' and tablename in('carts','cart_items') and cmd='SELECT'),4::bigint,'SELECT-only policies');
select extensions.ok(not has_table_privilege('persi_app','public.carts','insert,update,delete'),'app cart DML denied');
select extensions.ok(not has_table_privilege('persi_app','public.cart_items','insert,update,delete'),'app item DML denied');
select extensions.ok(not has_table_privilege('persi_worker','public.carts','insert,update,delete'),'worker cart DML denied');
select extensions.ok(not has_function_privilege('persi_worker','public.create_native_cart(uuid,uuid,text,character,timestamp with time zone)','execute'),'worker function denied');
select extensions.ok(has_function_privilege('persi_app','public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)','execute'),'app submit granted');
select extensions.ok(not has_function_privilege('anon','public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)','execute'),'anon submit denied');
select extensions.is((select count(*) from pg_proc p join pg_roles r on r.oid=p.proowner where p.pronamespace='public'::regnamespace and p.proname in('create_native_cart','add_native_cart_item','set_native_cart_item_quantity','remove_native_cart_item','merge_native_carts','submit_native_checkout','canonical_native_checkout_items_fingerprint','canonical_native_submission_request_hash') and r.rolname='postgres' and p.prosecdef and p.proconfig @> array['search_path=""']),8::bigint,'secure definers');
select extensions.is((select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='add_native_cart_item'),1::bigint,'legacy overload absent');

insert into public.stores(id,code,name,status) values('c1000000-0000-4000-8000-000000000001','m29c','M29C','active');
insert into public.customers(id,email) values('c2000000-0000-4000-8000-000000000001','m29c@example.invalid'),('c2000000-0000-4000-8000-000000000002','wrong@example.invalid');
insert into public.products(id,name,slug,status) values('c3000000-0000-4000-8000-000000000001','Synthetic','m29c-synthetic','draft');
insert into public.product_variants(id,product_id,sku,status) values('c4000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','M29C-A','draft'),('c4000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000001','M29C-B','draft');
set local role persi_app;
select extensions.lives_ok($$select public.create_native_cart('c1000000-0000-4000-8000-000000000001',null,repeat('a',64),'BRL',now()+interval '1 hour')$$,'guest create');
select extensions.lives_ok($$select public.create_native_cart('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',null,'BRL',now()+interval '1 hour')$$,'customer create');
select extensions.throws_ok($$insert into public.carts(store_id,guest_token_fingerprint,expires_at) values('c1000000-0000-4000-8000-000000000001',repeat('b',64),now()+interval '1 hour')$$,'42501',null,'direct cart denied');
select extensions.throws_ok($$insert into public.cart_items(cart_id,product_variant_id,quantity) select id,'c4000000-0000-4000-8000-000000000001',1 from public.carts limit 1$$,'42501',null,'direct item denied');
select extensions.throws_ok($$select public.add_native_cart_item((select id from public.carts where guest_token_fingerprint=repeat('a',64)),null,repeat('b',64),'c4000000-0000-4000-8000-000000000001',1)$$,'42501','CART_OWNERSHIP_INVALID','wrong guest');
select extensions.throws_ok($$select public.add_native_cart_item((select id from public.carts where customer_id='c2000000-0000-4000-8000-000000000001'),'c2000000-0000-4000-8000-000000000002',null,'c4000000-0000-4000-8000-000000000001',1)$$,'42501','CART_OWNERSHIP_INVALID','wrong customer');
select extensions.lives_ok($$select public.add_native_cart_item((select id from public.carts where guest_token_fingerprint=repeat('a',64)),null,repeat('a',64),'c4000000-0000-4000-8000-000000000001',2)$$,'add');
select extensions.is((select version from public.carts where guest_token_fingerprint=repeat('a',64)),1::bigint,'add version');
select extensions.lives_ok($$select public.set_native_cart_item_quantity((select id from public.carts where guest_token_fingerprint=repeat('a',64)),null,repeat('a',64),'c4000000-0000-4000-8000-000000000001',3)$$,'set');
select extensions.is((select version from public.carts where guest_token_fingerprint=repeat('a',64)),2::bigint,'set version');
select extensions.lives_ok($$select public.set_native_cart_item_quantity((select id from public.carts where guest_token_fingerprint=repeat('a',64)),null,repeat('a',64),'c4000000-0000-4000-8000-000000000001',3)$$,'set no-op');
select extensions.is((select version from public.carts where guest_token_fingerprint=repeat('a',64)),2::bigint,'no-op version');
select extensions.is(public.remove_native_cart_item((select id from public.carts where guest_token_fingerprint=repeat('a',64)),null,repeat('a',64),'c4000000-0000-4000-8000-000000000001'),true,'remove');
select extensions.is(public.remove_native_cart_item((select id from public.carts where guest_token_fingerprint=repeat('a',64)),null,repeat('a',64),'c4000000-0000-4000-8000-000000000001'),false,'remove no-op');
reset role;

insert into public.carts(id,store_id,guest_token_fingerprint,status,expires_at) values('c5000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001',repeat('1',64),'active',now()+interval '1 hour'),('c5000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001',repeat('2',64),'active',now()+interval '1 hour'),('c5000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001',repeat('3',64),'expired',now()+interval '1 hour');
insert into public.cart_items(id,cart_id,product_variant_id,quantity) values('c6000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001',1);
select extensions.throws_ok($$update public.cart_items set cart_id='c5000000-0000-4000-8000-000000000002' where id='c6000000-0000-4000-8000-000000000001'$$,'23514','CART_ITEM_REPARENT_FORBIDDEN','reparent denied');
select extensions.throws_ok($$update public.carts set version=version+2 where id='c5000000-0000-4000-8000-000000000001'$$,'40001','CART_VERSION_CONFLICT','version jump denied');
update public.carts set status='locked',version=version+1 where id='c5000000-0000-4000-8000-000000000001';
select extensions.throws_ok($$update public.cart_items set quantity=2 where id='c6000000-0000-4000-8000-000000000001'$$,'23514','CART_NOT_MUTABLE','locked immutable');
update public.carts set status='converted',version=version+1 where id='c5000000-0000-4000-8000-000000000001';
select extensions.throws_ok($$update public.carts set status='active',version=version+1 where id='c5000000-0000-4000-8000-000000000001'$$,'23514','CART_TRANSITION_INVALID','converted terminal');
select extensions.throws_ok($$insert into public.cart_items(cart_id,product_variant_id,quantity) values('c5000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000002',1)$$,'23514','CART_NOT_MUTABLE','converted immutable');
select extensions.throws_ok($$insert into public.cart_items(cart_id,product_variant_id,quantity) values('c5000000-0000-4000-8000-000000000003','c4000000-0000-4000-8000-000000000002',1)$$,'23514','CART_NOT_MUTABLE','expired immutable');
select extensions.throws_ok($$update public.carts set status='converted',version=version+1 where id='c5000000-0000-4000-8000-000000000002'$$,'23514','CART_TRANSITION_INVALID','direct convert denied');
select extensions.is((select is_nullable from information_schema.columns where table_schema='public' and table_name='orders' and column_name='submission_request_hash'),'YES','hash nullable globally');
select extensions.throws_ok($$insert into public.orders(id,store_id,order_sequence,order_number,status,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,submission_request_hash) values(gen_random_uuid(),'c1000000-0000-4000-8000-000000000001',900001,'BAD1','pending','BRL',0,0,'Synthetic','s@example.invalid','bad')$$,'23514',null,'bad hash denied');
select extensions.throws_ok($$insert into public.orders(id,store_id,order_sequence,order_number,status,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,submission_request_hash) values(gen_random_uuid(),'c1000000-0000-4000-8000-000000000001',900002,'BAD2','pending','BRL',0,0,'Synthetic','s@example.invalid',repeat('A',64))$$,'23514',null,'uppercase denied');
select extensions.ok((select p.prosecdef and not p.proisstrict and r.rolname='postgres' from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)'::regprocedure),'submit secure');
select extensions.ok(position('resolve_store_price_authority' in pg_get_functiondef('public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)'::regprocedure))>0,'price binding');
select extensions.ok(position('r1d_shipping_quote_is_authoritative' in pg_get_functiondef('public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)'::regprocedure))>0,'shipping binding');
select extensions.ok(position('confirm_inventory_reservation' in pg_get_functiondef('public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)'::regprocedure))=0,'no stock confirmation');
select * from extensions.finish();
rollback;
