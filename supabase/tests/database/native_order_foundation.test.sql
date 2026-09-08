begin;
select no_plan();
select has_type('public','order_status','order status enum');
select has_type('public','order_address_type','address type enum');
select has_type('public','order_adjustment_type','adjustment type enum');
select has_type('public','order_adjustment_direction','adjustment direction enum');
select has_type('public','order_actor_type','actor type enum');
select has_table('public','orders','orders exists');
select has_table('public','order_items','order items exists');
select has_table('public','order_addresses','order addresses exists');
select has_table('public','order_adjustments','order adjustments exists');
select has_table('public','order_status_events','order events exists');
select has_column('public','stores','next_order_sequence','store sequence exists');
select col_type_is('public','stores','next_order_sequence','bigint','store sequence bigint');
select col_type_is('public','orders','version','bigint','order version bigint');
select col_type_is('public','orders','grand_total_minor','bigint','grand total bigint');
select col_type_is('public','order_items','unit_effective_amount_minor','bigint','item money bigint');
select col_is_pk('public','orders','id','orders PK');
select col_is_pk('public','order_items','id','items PK');
select col_is_pk('public','order_addresses','id','addresses PK');
select col_is_pk('public','order_adjustments','id','adjustments PK');
select col_is_pk('public','order_status_events','id','events PK');
select fk_ok('public','orders','store_id','public','stores','id','order store FK');
select fk_ok('public','orders','customer_id','public','customers','id','order customer FK');
select fk_ok('public','orders','checkout_session_id','public','checkout_sessions','id','order checkout FK');
select fk_ok('public','order_items','product_id','public','products','id','item product FK');
select fk_ok('public','order_items','product_variant_id','public','product_variants','id','item variant FK');
select fk_ok('public','order_addresses','source_customer_address_id','public','customer_addresses','id','address provenance FK');
select has_index('public','orders','orders_store_sequence_unique','store sequence unique');
select has_index('public','orders','orders_store_number_unique','store number unique');
select has_index('public','orders','orders_checkout_session_id_key','checkout unique');
select has_index('public','order_items','order_items_order_idx','item read index');
select has_index('public','order_status_events','order_status_events_order_idx','event read index');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('orders'::regclass,'order_items'::regclass,'order_addresses'::regclass,'order_adjustments'::regclass,'order_status_events'::regclass)),'RLS 5/5');
select is((select count(*) from pg_policies where schemaname='public' and tablename like 'order%' and ('public'=any(roles) or 'anon'=any(roles) or 'authenticated'=any(roles))),0::bigint,'zero browser policies');
select is(has_table_privilege('anon','public.orders','select'),false,'anon blocked');
select is(has_table_privilege('authenticated','public.order_items','select'),false,'authenticated blocked');
select is(has_table_privilege('persi_readonly','public.order_addresses','select'),false,'readonly PII blocked');
select is(has_table_privilege('persi_app','public.orders','delete'),false,'app delete blocked');
select is(has_function_privilege('public','public.allocate_native_order_number(uuid)','execute'),false,'allocator public revoked');
select is(has_function_privilege('anon','public.transition_native_order(uuid,order_status,order_status,bigint,order_actor_type,text,text,text,uuid)','execute'),false,'transition anon revoked');

insert into stores(id,code,name,status) values ('41000000-0000-4000-8000-000000000001','sta','Store A','active'),('41000000-0000-4000-8000-000000000002','stb','Store B','active');
insert into customers(id,email) values ('42000000-0000-4000-8000-000000000001','before@example.invalid');
insert into customer_addresses(id,customer_id,recipient,street,number,neighborhood,postal_code,city,state) values ('43000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','Before','Street','1','District','13201000','Jundiai','SP');
insert into products(id,name,slug,status,published_at) values ('44000000-0000-4000-8000-000000000001','Original Product','c2-original','active',now());
insert into product_variants(id,product_id,sku,status) values ('45000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','C2-SKU','active');

select is((select order_sequence from allocate_native_order_number('41000000-0000-4000-8000-000000000001')),1::bigint,'first A sequence');
select is((select order_sequence from allocate_native_order_number('41000000-0000-4000-8000-000000000001')),2::bigint,'second A sequence');
select is((select order_sequence from allocate_native_order_number('41000000-0000-4000-8000-000000000002')),1::bigint,'first B independent');
select matches((select order_number from allocate_native_order_number('41000000-0000-4000-8000-000000000002')),'^STB-[0-9]{4}-000002$','stable display');

insert into orders(id,store_id,customer_id,order_sequence,order_number,currency,items_subtotal_minor,discount_total_minor,shipping_total_minor,tax_total_minor,fee_total_minor,grand_total_minor,contact_name,contact_email,contact_phone,correlation_id)
values ('46000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',null,10,'STA-TEST-10','BRL',3000,200,700,300,200,4000,'Guest Test','guest@example.invalid','+5511999999999','47000000-0000-4000-8000-000000000001'),
('46000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001',11,'STA-TEST-11','BRL',1000,0,0,0,0,1000,'Registered Snapshot','registered@example.invalid',null,'47000000-0000-4000-8000-000000000002');
select is((select customer_id from orders where id='46000000-0000-4000-8000-000000000001'),null::uuid,'guest customer nullable');
select is((select count(*) from customers),1::bigint,'guest did not create customer');
select throws_ok($$insert into orders(store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email) values('41000000-0000-4000-8000-000000000001',12,'BAD','BRL',100,99,'Bad','bad@example.invalid')$$,'23514',null,'invalid total rejected');
select throws_ok($$insert into orders(store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,tax_id_type,tax_id_ciphertext) values('41000000-0000-4000-8000-000000000001',12,'BADTAX','BRL',100,100,'Bad','bad@example.invalid','cpf','cipher')$$,'23514',null,'partial tax bundle rejected');

insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,gtin_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint)
values ('48000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001',1,'44000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000001','C2-SKU','7891234567890','Original Product',2,1800,1500,3000,200,300,3100,'BRL',repeat('a',64));
insert into order_addresses(order_id,address_type,recipient,street,number,neighborhood,city,state,postal_code,country) values
('46000000-0000-4000-8000-000000000001','billing','Guest Test','Order Street','10','Order District','Jundiai','SP','13201000','BR'),
('46000000-0000-4000-8000-000000000001','shipping','Guest Test','Ship Street','20','Ship District','Itupeva','SP','13295000','BR');
insert into order_adjustments(id,order_id,adjustment_type,direction,amount_minor,currency,code_snapshot,description_snapshot) values
('49000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001','coupon','discount',300,'BRL','C2TEST','Coupon snapshot'),
('49000000-0000-4000-8000-000000000002','46000000-0000-4000-8000-000000000001','fee','charge',200,'BRL',null,'Service fee');
insert into order_adjustments(order_id,adjustment_type,direction,amount_minor,currency,description_snapshot,reverses_adjustment_id) values
('46000000-0000-4000-8000-000000000001','correction','charge',300,'BRL','Coupon reversal','49000000-0000-4000-8000-000000000001');
select is(validate_native_order_totals('46000000-0000-4000-8000-000000000001'),true,'aggregate totals validated');
select is((select count(*) from order_addresses where order_id='46000000-0000-4000-8000-000000000001'),2::bigint,'billing and shipping snapshots');
select throws_ok($$update order_items set sku_snapshot='CHANGED' where id='48000000-0000-4000-8000-000000000001'$$,'23514','order_child_immutable','item immutable');
select throws_ok($$delete from order_addresses where order_id='46000000-0000-4000-8000-000000000001'$$,'23514','order_history_delete_forbidden','address delete blocked');
select throws_ok($$update order_adjustments set amount_minor=1 where id='49000000-0000-4000-8000-000000000001'$$,'23514','order_child_immutable','adjustment immutable');
select throws_ok($$update orders set status='completed',version=1,completed_at=now() where id='46000000-0000-4000-8000-000000000001'$$,'23514','invalid_order_status_transition','invalid status blocked');
insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values('46000000-0000-4000-8000-000000000001',null,'pending','system','4a000000-0000-4000-8000-000000000001');
select lives_ok($$select transition_native_order('46000000-0000-4000-8000-000000000001','pending','confirmed',0,'admin','synthetic-admin','confirmed','Synthetic confirmation','4a000000-0000-4000-8000-000000000002')$$,'controlled transition');
select is((select status::text from orders where id='46000000-0000-4000-8000-000000000001'),'confirmed','status updated');
select is((select version from orders where id='46000000-0000-4000-8000-000000000001'),1::bigint,'version incremented');
select is((select count(*) from order_status_events where order_id='46000000-0000-4000-8000-000000000001'),2::bigint,'transition event appended');
select throws_ok($$select transition_native_order('46000000-0000-4000-8000-000000000001','pending','cancelled',0,'admin',null,null,null,gen_random_uuid())$$,'40001','stale_order_transition','stale transition blocked');
select throws_ok($$update order_status_events set reason='rewrite' where order_id='46000000-0000-4000-8000-000000000001'$$,'23514','order_child_immutable','event append only');
update customers set email='after@example.invalid' where id='42000000-0000-4000-8000-000000000001';
select is((select contact_email from orders where id='46000000-0000-4000-8000-000000000002'),'registered@example.invalid','contact snapshot stable');
update products set name='Changed Product' where id='44000000-0000-4000-8000-000000000001';
select is((select product_name_snapshot from order_items where id='48000000-0000-4000-8000-000000000001'),'Original Product','product snapshot stable');
select throws_ok($$delete from product_variants where id='45000000-0000-4000-8000-000000000001'$$,'23503',null,'catalog hard delete restricted');
select is((select sku_snapshot from order_items where id='48000000-0000-4000-8000-000000000001'),'C2-SKU','snapshot understandable after delete attempt');
select * from finish();
rollback;
