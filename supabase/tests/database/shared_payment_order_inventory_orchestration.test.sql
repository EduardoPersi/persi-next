begin;
select no_plan();

-- ---------- security: PUBLIC/anon/authenticated/persi_app blocked, persi_worker allowed ----------
select is(has_function_privilege('public','public.apply_verified_payment_transition(uuid,payment_event_type,text,text,payment_attempt_status,text)','execute'),false,'PUBLIC blocked');
select is(has_function_privilege('anon','public.apply_verified_payment_transition(uuid,payment_event_type,text,text,payment_attempt_status,text)','execute'),false,'anon blocked');
select is(has_function_privilege('authenticated','public.apply_verified_payment_transition(uuid,payment_event_type,text,text,payment_attempt_status,text)','execute'),false,'authenticated blocked');
select is(has_function_privilege('persi_app','public.apply_verified_payment_transition(uuid,payment_event_type,text,text,payment_attempt_status,text)','execute'),false,'persi_app blocked (browser cannot self-confirm payment)');
select is(has_function_privilege('persi_worker','public.apply_verified_payment_transition(uuid,payment_event_type,text,text,payment_attempt_status,text)','execute'),true,'persi_worker allowed');

-- ---------- fixtures: two independent orders (A, B), each with one reserved item ----------
insert into stores(id,code,name,status) values
  ('80000000-0000-4000-8000-000000000001','spo1','Shared Orchestration Store','active');
insert into products(id,name,slug,status,published_at) values
  ('82000000-0000-4000-8000-000000000001','Orchestration Product','spo-product','active',now());
insert into product_variants(id,product_id,sku,status) values
  ('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','SPO-SKU','active');
insert into inventory_locations(id,code,name,status) values
  ('84000000-0000-4000-8000-000000000001','spo_location','SPO Location','active');
insert into inventory_levels(id,product_variant_id,inventory_location_id,quantity_on_hand,quantity_reserved) values
  ('85000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',100,0);

insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id) values
  ('81000000-0000-4000-8000-00000000000a','80000000-0000-4000-8000-000000000001',1,'SPO-A','BRL',5000,5000,'Order A','order-a@example.invalid',gen_random_uuid()),
  ('81000000-0000-4000-8000-00000000000b','80000000-0000-4000-8000-000000000001',2,'SPO-B','BRL',5000,5000,'Order B','order-b@example.invalid',gen_random_uuid());
insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values
  ('81000000-0000-4000-8000-00000000000a',null,'pending','system',gen_random_uuid()),
  ('81000000-0000-4000-8000-00000000000b',null,'pending','system',gen_random_uuid());
insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint) values
  ('86000000-0000-4000-8000-00000000000a','81000000-0000-4000-8000-00000000000a',1,'82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','SPO-SKU','Orchestration Product',5,1000,1000,5000,0,0,5000,'BRL',repeat('a',64)),
  ('86000000-0000-4000-8000-00000000000b','81000000-0000-4000-8000-00000000000b',1,'82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','SPO-SKU','Orchestration Product',5,1000,1000,5000,0,0,5000,'BRL',repeat('b',64));
-- Inserted WITH order_item_id already populated: validate_inventory_reservation_
-- order_link only fires on UPDATE of that column, never on INSERT (see
-- 20260903130000_public_browser_privilege_remediation.sql) -- a synthetic,
-- non-checkout fixture can set it directly, exactly like this project's own
-- native_checkout_order_integrity_hardening.test.sql does for its own
-- non-checkout-originated rows.
insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,order_item_id) values
  ('87000000-0000-4000-8000-00000000000a','85000000-0000-4000-8000-000000000001',5,'active','order','order-a','spo-idem-a',now()+interval '1 hour','86000000-0000-4000-8000-00000000000a'),
  ('87000000-0000-4000-8000-00000000000b','85000000-0000-4000-8000-000000000001',5,'active','order','order-b','spo-idem-b',now()+interval '1 hour','86000000-0000-4000-8000-00000000000b');
-- Fixture rows are inserted directly (bypassing reserve_inventory, which
-- normally increments quantity_reserved atomically as part of creating the
-- row) -- kept in sync manually here so the level's own invariants hold.
update inventory_levels set quantity_reserved = quantity_reserved + 10 where id = '85000000-0000-4000-8000-000000000001';

insert into payment_attempts(id,order_id,provider,method,amount_minor,currency,idempotency_key,status,version) values
  ('88000000-0000-4000-8000-00000000000a','81000000-0000-4000-8000-00000000000a','mercado_pago','credit_card',5000,'BRL','spo-attempt-a','pending',1),
  ('88000000-0000-4000-8000-00000000000b','81000000-0000-4000-8000-00000000000b','banco_inter','pix',5000,'BRL','spo-attempt-b','pending',1);

-- ---------- happy path: paid confirms exactly order A's reservation, never touches B ----------
select lives_ok($$select apply_verified_payment_transition('88000000-0000-4000-8000-00000000000a','status_observed',null,'approved','paid')$$,'paid transition succeeds');
select is((select status::text from payment_attempts where id='88000000-0000-4000-8000-00000000000a'),'paid','attempt A is paid');
select is((select status::text from orders where id='81000000-0000-4000-8000-00000000000a'),'confirmed','order A confirmed');
select is((select status::text from inventory_reservations where id='87000000-0000-4000-8000-00000000000a'),'confirmed','reservation A confirmed');
select is((select quantity_on_hand from inventory_levels where id='85000000-0000-4000-8000-000000000001'),95::bigint,'on_hand decremented by exactly the confirmed reservation quantity');
select is((select quantity_reserved from inventory_levels where id='85000000-0000-4000-8000-000000000001'),5::bigint,'reserved decremented back down (order A''s 5 removed from the reserved pool on confirm; only order B''s 5 remains)');

-- ---------- CROSS_ORDER_MUTATION_BLOCKED: order B / reservation B completely untouched ----------
select is((select status::text from orders where id='81000000-0000-4000-8000-00000000000b'),'pending','order B untouched');
select is((select status::text from payment_attempts where id='88000000-0000-4000-8000-00000000000b'),'pending','attempt B untouched');
select is((select status::text from inventory_reservations where id='87000000-0000-4000-8000-00000000000b'),'active','reservation B untouched');

-- ---------- PAYMENT_TRANSITION_IDEMPOTENCY_PASS: replay never re-confirms, never re-transitions the order ----------
select is((select order_transitioned from apply_verified_payment_transition('88000000-0000-4000-8000-00000000000a','webhook_received','spo-evt-replay-1','approved','paid')),false,'replay #1: order_transitioned=false');
select is((select inventory_confirmed_count from apply_verified_payment_transition('88000000-0000-4000-8000-00000000000a','webhook_received','spo-evt-replay-2','approved','paid')),0,'replay #2: inventory_confirmed_count=0');
select is((select quantity_on_hand from inventory_levels where id='85000000-0000-4000-8000-000000000001'),95::bigint,'on_hand unchanged after 2 replays -- confirmed exactly once');
select is((select count(*) from order_status_events where order_id='81000000-0000-4000-8000-00000000000a'),2::bigint,'exactly one status transition event recorded (initial pending + the one confirm), replays added none');

-- ---------- INVENTORY_CONFIRM_IDEMPOTENCY_PASS: calling confirm_inventory_reservation directly a second time is ALSO a safe no-op (defense in depth, independent of the orchestrator) ----------
select lives_ok($$select confirm_inventory_reservation('87000000-0000-4000-8000-00000000000a','manual-replay','test')$$,'direct re-confirm does not raise');
select is((select quantity_on_hand from inventory_levels where id='85000000-0000-4000-8000-000000000001'),95::bigint,'still unchanged after a direct re-confirm attempt');

-- ---------- terminal failure path: release, on a fresh independent attempt/order ----------
insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id) values
  ('81000000-0000-4000-8000-00000000000c','80000000-0000-4000-8000-000000000001',3,'SPO-C','BRL',5000,5000,'Order C','order-c@example.invalid',gen_random_uuid());
insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values
  ('81000000-0000-4000-8000-00000000000c',null,'pending','system',gen_random_uuid());
insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint) values
  ('86000000-0000-4000-8000-00000000000c','81000000-0000-4000-8000-00000000000c',1,'82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','SPO-SKU','Orchestration Product',3,1000,1000,3000,0,0,3000,'BRL',repeat('c',64));
insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,order_item_id) values
  ('87000000-0000-4000-8000-00000000000c','85000000-0000-4000-8000-000000000001',3,'active','order','order-c','spo-idem-c',now()+interval '1 hour','86000000-0000-4000-8000-00000000000c');
update inventory_levels set quantity_reserved = quantity_reserved + 3 where id = '85000000-0000-4000-8000-000000000001';
insert into payment_attempts(id,order_id,provider,method,amount_minor,currency,idempotency_key,status,version) values
  ('88000000-0000-4000-8000-00000000000c','81000000-0000-4000-8000-00000000000c','pagbank','apple_pay',5000,'BRL','spo-attempt-c','pending',1);

select is((select quantity_reserved from inventory_levels where id='85000000-0000-4000-8000-000000000001'),8::bigint,'reserved includes order C''s 3 before release (order B''s 5 + order C''s 3)');
select lives_ok($$select apply_verified_payment_transition('88000000-0000-4000-8000-00000000000c','status_observed',null,'DECLINED','failed')$$,'terminal failure transition succeeds');
select is((select status::text from payment_attempts where id='88000000-0000-4000-8000-00000000000c'),'failed','attempt C is failed');
select is((select status::text from orders where id='81000000-0000-4000-8000-00000000000c'),'cancelled','order C cancelled');
select is((select status::text from inventory_reservations where id='87000000-0000-4000-8000-00000000000c'),'released','reservation C released');
select is((select quantity_reserved from inventory_levels where id='85000000-0000-4000-8000-000000000001'),5::bigint,'reserved back down after release (order C''s 3 removed; only order B''s 5 remains)');
select is((select quantity_on_hand from inventory_levels where id='85000000-0000-4000-8000-000000000001'),95::bigint,'on_hand unaffected by a release (only confirm decrements on_hand)');

-- Replay after terminal failure is ALSO idempotent (no double release, no order re-transition).
select is((select order_transitioned from apply_verified_payment_transition('88000000-0000-4000-8000-00000000000c','reconciliation_probe',null,'DECLINED','failed')),false,'terminal replay: order_transitioned=false');
select is((select inventory_released_count from apply_verified_payment_transition('88000000-0000-4000-8000-00000000000c','reconciliation_probe',null,'DECLINED','failed')),0,'terminal replay: inventory_released_count=0');

-- ---------- AUTHORIZED must never confirm inventory (Section 17) ----------
insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id) values
  ('81000000-0000-4000-8000-00000000000d','80000000-0000-4000-8000-000000000001',4,'SPO-D','BRL',5000,5000,'Order D','order-d@example.invalid',gen_random_uuid());
insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values
  ('81000000-0000-4000-8000-00000000000d',null,'pending','system',gen_random_uuid());
insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint) values
  ('86000000-0000-4000-8000-00000000000d','81000000-0000-4000-8000-00000000000d',1,'82000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','SPO-SKU','Orchestration Product',2,1000,1000,2000,0,0,2000,'BRL',repeat('d',64));
insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,order_item_id) values
  ('87000000-0000-4000-8000-00000000000d','85000000-0000-4000-8000-000000000001',2,'active','order','order-d','spo-idem-d',now()+interval '1 hour','86000000-0000-4000-8000-00000000000d');
insert into payment_attempts(id,order_id,provider,method,amount_minor,currency,idempotency_key,status,version) values
  ('88000000-0000-4000-8000-00000000000d','81000000-0000-4000-8000-00000000000d','mercado_pago','credit_card',5000,'BRL','spo-attempt-d','pending',1);

select is((select order_transitioned from apply_verified_payment_transition('88000000-0000-4000-8000-00000000000d','status_observed',null,'authorized','authorized')),false,'authorized: order_transitioned=false');
select is((select status::text from orders where id='81000000-0000-4000-8000-00000000000d'),'pending','order D still pending after mere authorization');
select is((select status::text from inventory_reservations where id='87000000-0000-4000-8000-00000000000d'),'active','reservation D still active, not confirmed, on authorized alone');

-- ---------- ATOMICITY: order already non-pending forces the WHOLE call to roll back, including the payment's own transition ----------
select lives_ok($$select transition_native_order('81000000-0000-4000-8000-00000000000d','pending','cancelled',0,'admin',null,'manual_test_cancel',null,gen_random_uuid())$$,'order D force-cancelled out of band (simulating a race)');
select throws_ok($$select apply_verified_payment_transition('88000000-0000-4000-8000-00000000000d','status_observed',null,'approved','paid')$$,'40001','stale_order_transition','order no longer pending -> whole call raises');
select is((select status::text from payment_attempts where id='88000000-0000-4000-8000-00000000000d'),'authorized','payment ROLLED BACK to its pre-call status, never left at paid');
select is((select version from payment_attempts where id='88000000-0000-4000-8000-00000000000d'),2::bigint,'version unchanged by the rolled-back call');
select is((select status::text from inventory_reservations where id='87000000-0000-4000-8000-00000000000d'),'active','reservation D never confirmed (rolled back along with everything else)');

-- ---------- refunded/partially_refunded: payment ledger updates, order/inventory deliberately untouched (Section 7 -- no order.status refunded state exists) ----------
insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id) values
  ('81000000-0000-4000-8000-00000000000e','80000000-0000-4000-8000-000000000001',5,'SPO-E','BRL',5000,5000,'Order E','order-e@example.invalid',gen_random_uuid());
insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values
  ('81000000-0000-4000-8000-00000000000e',null,'pending','system',gen_random_uuid());
insert into payment_attempts(id,order_id,provider,method,amount_minor,currency,idempotency_key,status,version,paid_at) values
  ('88000000-0000-4000-8000-00000000000e','81000000-0000-4000-8000-00000000000e','mercado_pago','credit_card',5000,'BRL','spo-attempt-e','paid',2,now());
select lives_ok($$select apply_verified_payment_transition('88000000-0000-4000-8000-00000000000e','status_observed',null,'refunded','refunded')$$,'refunded transition on the ledger succeeds');
select is((select status::text from payment_attempts where id='88000000-0000-4000-8000-00000000000e'),'refunded','attempt E is refunded at the ledger level');
select is((select status::text from orders where id='81000000-0000-4000-8000-00000000000e'),'pending','order E left exactly as-is -- no refunded order status exists, not invented here');

-- ---------- invalid relationship: nonexistent attempt id rejected cleanly ----------
select throws_ok($$select apply_verified_payment_transition('89000000-0000-4000-8000-000000000000','status_observed',null,'approved','paid')$$,'P0002','payment_attempt_not_found','nonexistent attempt rejected');

-- ---------- RLS/table privileges remain exactly as the payment ledger round left them ----------
select is(has_table_privilege('anon','public.payment_attempts','select'),false,'anon still blocked from attempts (unchanged)');
select is(has_table_privilege('persi_app','public.payment_attempts','update'),false,'persi_app still cannot update attempts directly (unchanged)');

select * from finish();
rollback;
