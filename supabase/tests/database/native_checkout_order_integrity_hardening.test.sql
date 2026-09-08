begin;
select no_plan();

select is(has_table_privilege('persi_app','public.stores','select'),true,'app retains store SELECT');
select is(has_table_privilege('persi_app','public.stores','insert'),false,'app store INSERT denied');
select is(has_table_privilege('persi_app','public.stores','update'),false,'app store UPDATE denied');
select is(has_table_privilege('persi_worker','public.stores','insert'),false,'worker store INSERT denied');
select is(has_table_privilege('persi_worker','public.stores','update'),false,'worker store UPDATE denied');
select is(has_table_privilege('persi_readonly','public.stores','select'),true,'readonly retained');
select is(has_table_privilege('anon','public.stores','select'),false,'anon store denied');
select is((select count(*) from pg_policies where schemaname='public' and tablename='stores' and cmd='ALL'),0::bigint,'no permissive ALL store policy');
select has_column('public','inventory_reservations','order_item_id','order item link exists');
select fk_ok('public','inventory_reservations','order_item_id','public','order_items','id','reservation order item FK');
select has_index('public','inventory_reservations','inventory_reservations_order_item_level_unique','partial order item unique');
select is(has_function_privilege('anon','public.link_inventory_reservation_to_order_item(uuid,uuid)','execute'),false,'browser cannot link reservation');
select is(has_function_privilege('persi_app','public.link_inventory_reservation_to_order_item(uuid,uuid)','execute'),true,'app controlled link enabled');

insert into stores(id,code,name,status) values
 ('51000000-0000-4000-8000-000000000001','p3b_a','P3B A','active'),
 ('51000000-0000-4000-8000-000000000002','p3b_b','P3B B','active');
insert into price_lists(id,code,name,currency,channel,status) values('52000000-0000-4000-8000-000000000001','p3b_prices','P3B Prices','BRL','storefront','active');
insert into store_price_list_assignments(id,store_id,price_list_id,currency,commercial_context,version,valid_from) values
 ('53000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','BRL','storefront_retail',1,now()-interval '1 day');
select lives_ok($$select * from resolve_store_price_authority('51000000-0000-4000-8000-000000000001','BRL','storefront_retail',now())$$,'price authority resolver remains functional');
select is(has_function_privilege('persi_app','public.resolve_store_price_authority(uuid,character,commercial_context,timestamp with time zone)','execute'),true,'app may resolve price authority');
select is((select count(*) from stores where id in ('51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002')),2::bigint,'store rows unchanged by hardening');

insert into products(id,name,slug,status,published_at) values
 ('54000000-0000-4000-8000-000000000001','P3B Product A','p3b-product-a','active',now()),
 ('54000000-0000-4000-8000-000000000002','P3B Product B','p3b-product-b','active',now());
insert into product_variants(id,product_id,sku,status) values
 ('55000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000001','P3B-A','active'),
 ('55000000-0000-4000-8000-000000000002','54000000-0000-4000-8000-000000000002','P3B-B','active');
insert into prices(id,product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values
 ('56000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',1000,'BRL',now()-interval '1 hour'),
 ('56000000-0000-4000-8000-000000000002','55000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001',1000,'BRL',now()-interval '1 hour');
insert into inventory_locations(id,code,name,status) values
 ('57000000-0000-4000-8000-000000000001','p3b_location','P3B Location','active'),
 ('57000000-0000-4000-8000-000000000002','p3b_location_2','P3B Location 2','active'),
 ('57000000-0000-4000-8000-000000000003','p3b_location_3','P3B Location 3','active'),
 ('57000000-0000-4000-8000-000000000004','p3b_location_4','P3B Location 4','active');
insert into inventory_levels(id,product_variant_id,inventory_location_id,quantity_on_hand,quantity_reserved) values
 ('58000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','57000000-0000-4000-8000-000000000001',20,7),
 ('58000000-0000-4000-8000-000000000002','55000000-0000-4000-8000-000000000001','57000000-0000-4000-8000-000000000002',20,1),
 ('58000000-0000-4000-8000-000000000003','55000000-0000-4000-8000-000000000001','57000000-0000-4000-8000-000000000003',20,2),
 ('58000000-0000-4000-8000-000000000004','55000000-0000-4000-8000-000000000001','57000000-0000-4000-8000-000000000004',20,1);
insert into carts(id,store_id,guest_token_fingerprint,expires_at,status) values
 ('59000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 hour','locked'),
 ('59000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001',repeat('b',64),now()+interval '1 hour','locked');
insert into checkout_sessions(id,store_id,cart_id,status,currency,idempotency_key,request_hash,cart_version,expires_at,store_price_list_assignment_id,store_price_list_assignment_version,price_list_id) values
 ('5a000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','59000000-0000-4000-8000-000000000001','validating','BRL','p3b-checkout-0001',repeat('c',64),0,now()+interval '30 minutes','53000000-0000-4000-8000-000000000001',1,'52000000-0000-4000-8000-000000000001'),
 ('5a000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001','59000000-0000-4000-8000-000000000002','validating','BRL','p3b-checkout-0002',repeat('d',64),0,now()+interval '30 minutes','53000000-0000-4000-8000-000000000001',1,'52000000-0000-4000-8000-000000000001');
insert into checkout_session_items(id,checkout_session_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_total_minor,currency,price_id,price_valid_from,price_fingerprint,source_fingerprint) values
 ('5b000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001',1,'54000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','P3B-A','A',1,1000,1000,1000,1000,'BRL','56000000-0000-4000-8000-000000000001',now(),repeat('e',64),repeat('f',64)),
 ('5b000000-0000-4000-8000-000000000002','5a000000-0000-4000-8000-000000000002',1,'54000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','P3B-A','A',1,1000,1000,1000,1000,'BRL','56000000-0000-4000-8000-000000000001',now(),repeat('1',64),repeat('2',64));

insert into orders(id,store_id,checkout_session_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email) values
 ('5c000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000001',101,'P3B-101','BRL',2000,2000,'Synthetic','synthetic@example.invalid'),
 ('5c000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001','5a000000-0000-4000-8000-000000000002',102,'P3B-102','BRL',1000,1000,'Synthetic','synthetic@example.invalid');
insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values
 ('5c000000-0000-4000-8000-000000000001',null,'pending','system','5d000000-0000-4000-8000-000000000001'),
 ('5c000000-0000-4000-8000-000000000002',null,'pending','system','5d000000-0000-4000-8000-000000000002');
insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_total_minor,currency,source_fingerprint) values
 ('5e000000-0000-4000-8000-000000000001','5c000000-0000-4000-8000-000000000001',1,'54000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','P3B-A','A',1,1000,1000,1000,1000,'BRL',repeat('3',64)),
 ('5e000000-0000-4000-8000-000000000002','5c000000-0000-4000-8000-000000000001',2,'54000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','P3B-A2','A2',1,1000,1000,1000,1000,'BRL',repeat('4',64)),
 ('5e000000-0000-4000-8000-000000000003','5c000000-0000-4000-8000-000000000001',3,'54000000-0000-4000-8000-000000000002','55000000-0000-4000-8000-000000000002','P3B-B','B',1,1000,1000,1000,1000,'BRL',repeat('5',64)),
 ('5e000000-0000-4000-8000-000000000004','5c000000-0000-4000-8000-000000000002',1,'54000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','P3B-CROSS','Cross',1,1000,1000,1000,1000,'BRL',repeat('6',64));

insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,checkout_session_item_id,created_at) values
 ('60000000-0000-4000-8000-000000000001','58000000-0000-4000-8000-000000000001',1,'active','checkout_session_item','r1','p3b-r1',now()+interval '20 minutes','5b000000-0000-4000-8000-000000000001',now()),
 ('60000000-0000-4000-8000-000000000002','58000000-0000-4000-8000-000000000001',1,'released','checkout_session_item','r2','p3b-r2',now()+interval '20 minutes',null,now()),
 ('60000000-0000-4000-8000-000000000003','58000000-0000-4000-8000-000000000001',1,'active','checkout_session_item','r3','p3b-r3',now()-interval '1 minute',null,now()-interval '1 hour'),
 ('60000000-0000-4000-8000-000000000004','58000000-0000-4000-8000-000000000002',1,'active','checkout_session_item','r4','p3b-r4',now()+interval '20 minutes','5b000000-0000-4000-8000-000000000001',now()),
 ('60000000-0000-4000-8000-000000000005','58000000-0000-4000-8000-000000000003',2,'active','checkout_session_item','r5','p3b-r5',now()+interval '20 minutes','5b000000-0000-4000-8000-000000000001',now()),
 ('60000000-0000-4000-8000-000000000006','58000000-0000-4000-8000-000000000004',1,'active','checkout_session_item','r6','p3b-r6',now()+interval '20 minutes','5b000000-0000-4000-8000-000000000001',now());

select lives_ok($$select link_inventory_reservation_to_order_item('60000000-0000-4000-8000-000000000001','5e000000-0000-4000-8000-000000000001')$$,'NULL to order item allowed');
select lives_ok($$select link_inventory_reservation_to_order_item('60000000-0000-4000-8000-000000000001','5e000000-0000-4000-8000-000000000001')$$,'same link idempotent');
select throws_ok($$select link_inventory_reservation_to_order_item('60000000-0000-4000-8000-000000000001','5e000000-0000-4000-8000-000000000002')$$,'23514','RESERVATION_LINK_CONFLICT','relink rejected');
select throws_ok($$update inventory_reservations set order_item_id=null where id='60000000-0000-4000-8000-000000000001'$$,'23514','RESERVATION_LINK_CONFLICT','unlink rejected');
select throws_ok($$select link_inventory_reservation_to_order_item('60000000-0000-4000-8000-000000000002','5e000000-0000-4000-8000-000000000002')$$,'23514','RESERVATION_NOT_ACTIVE','inactive rejected');
select throws_ok($$select link_inventory_reservation_to_order_item('60000000-0000-4000-8000-000000000003','5e000000-0000-4000-8000-000000000002')$$,'23514','RESERVATION_EXPIRED','expired rejected');
select throws_ok($$select link_inventory_reservation_to_order_item('60000000-0000-4000-8000-000000000004','5e000000-0000-4000-8000-000000000003')$$,'23514','RESERVATION_VARIANT_MISMATCH','variant mismatch rejected');
select throws_ok($$select link_inventory_reservation_to_order_item('60000000-0000-4000-8000-000000000005','5e000000-0000-4000-8000-000000000002')$$,'23514','RESERVATION_QUANTITY_MISMATCH','quantity mismatch rejected');
select throws_ok($$select link_inventory_reservation_to_order_item('60000000-0000-4000-8000-000000000006','5e000000-0000-4000-8000-000000000004')$$,'23514','RESERVATION_ORDER_SCOPE_MISMATCH','cross checkout rejected');
select is((select status::text from inventory_reservations where id='60000000-0000-4000-8000-000000000001'),'active','link keeps reservation active');
select is((select quantity_reserved from inventory_levels where id='58000000-0000-4000-8000-000000000001'),7::bigint,'link does not alter reserved stock');
select is((select count(*) from inventory_movements),0::bigint,'link creates no movement');

select throws_ok($$insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email) values('61000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',201,'P3B-201','BRL',0,0,'No Event','none@example.invalid'); set constraints orders_initial_event_required immediate$$,'23514','ORDER_INITIAL_EVENT_REQUIRED','order without initial event cannot commit');
select lives_ok($$insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email) values('61000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001',202,'P3B-202','BRL',0,0,'Event','event@example.invalid'); insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values('61000000-0000-4000-8000-000000000002',null,'pending','system','62000000-0000-4000-8000-000000000002'); set constraints all immediate$$,'exact initial event accepted');
set constraints all deferred;
select throws_ok($$insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values('61000000-0000-4000-8000-000000000002',null,'confirmed','system',gen_random_uuid())$$,'23514',null,'wrong initial status rejected');
select throws_ok($$insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values('61000000-0000-4000-8000-000000000002',null,'pending','system',gen_random_uuid())$$,'23505',null,'duplicate initial event rejected');
select throws_ok($$update order_status_events set reason='rewrite' where order_id='61000000-0000-4000-8000-000000000002'$$,'23514','order_child_immutable','event remains append only');

select throws_ok($test$do $rollback$ begin perform allocate_native_order_number('51000000-0000-4000-8000-000000000002'); insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email) values('63000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',1,'ROLLBACK-1','BRL',0,0,'Rollback','rollback@example.invalid'); insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values('63000000-0000-4000-8000-000000000001',null,'pending','system',gen_random_uuid()); raise exception 'FORCED_ROLLBACK'; end $rollback$;$test$,'P0001','FORCED_ROLLBACK','forced transaction rollback');
select is((select count(*) from orders where id='63000000-0000-4000-8000-000000000001'),0::bigint,'rollback removes order');
select is((select count(*) from order_status_events where order_id='63000000-0000-4000-8000-000000000001'),0::bigint,'rollback removes initial event');
select is((select next_order_sequence from stores where id='51000000-0000-4000-8000-000000000002'),1::bigint,'rollback restores sequence');
select throws_ok($test$do $rollback$ begin perform link_inventory_reservation_to_order_item('60000000-0000-4000-8000-000000000004','5e000000-0000-4000-8000-000000000001'); raise exception 'FORCED_LINK_ROLLBACK'; end $rollback$;$test$,'P0001','FORCED_LINK_ROLLBACK','forced linkage rollback');
select is((select order_item_id from inventory_reservations where id='60000000-0000-4000-8000-000000000004'),null::uuid,'rollback leaves reservation unlinked');

select * from finish();
rollback;
