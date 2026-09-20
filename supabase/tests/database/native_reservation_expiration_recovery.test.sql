begin;
select no_plan();

-- ---------- security: PUBLIC/anon/authenticated/persi_app blocked, persi_worker allowed ----------
select is(has_function_privilege('public','public.reclaim_expired_native_reservations(integer,text)','execute'),false,'PUBLIC blocked');
select is(has_function_privilege('anon','public.reclaim_expired_native_reservations(integer,text)','execute'),false,'anon blocked');
select is(has_function_privilege('authenticated','public.reclaim_expired_native_reservations(integer,text)','execute'),false,'authenticated blocked');
select is(has_function_privilege('persi_app','public.reclaim_expired_native_reservations(integer,text)','execute'),false,'persi_app blocked (browser cannot reclaim stock on its own initiative)');
select is(has_function_privilege('persi_worker','public.reclaim_expired_native_reservations(integer,text)','execute'),true,'persi_worker allowed');

-- ---------- fixtures ----------
insert into stores(id,code,name,status) values
  ('90000000-0000-4000-8000-000000000001','rer1','Reservation Expiration Store','active');
insert into products(id,name,slug,status,published_at) values
  ('92000000-0000-4000-8000-000000000001','Expiration Product','rer-product','active',now());
insert into product_variants(id,product_id,sku,status) values
  ('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','RER-SKU','active');
insert into inventory_locations(id,code,name,status) values
  ('94000000-0000-4000-8000-000000000001','rer_location','RER Location','active');
insert into inventory_levels(id,product_variant_id,inventory_location_id,quantity_on_hand,quantity_reserved) values
  ('95000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001',100,0);

-- ---------- A1 / A8: one expired active reservation released once; a non-expired one left untouched ----------
insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id) values
  ('91000000-0000-4000-8000-00000000000a','90000000-0000-4000-8000-000000000001',1,'RER-A','BRL',5000,5000,'Order A','order-a@example.invalid',gen_random_uuid()),
  ('91000000-0000-4000-8000-00000000000b','90000000-0000-4000-8000-000000000001',2,'RER-B','BRL',5000,5000,'Order B','order-b@example.invalid',gen_random_uuid());
insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values
  ('91000000-0000-4000-8000-00000000000a',null,'pending','system',gen_random_uuid()),
  ('91000000-0000-4000-8000-00000000000b',null,'pending','system',gen_random_uuid());
insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint) values
  ('96000000-0000-4000-8000-00000000000a','91000000-0000-4000-8000-00000000000a',1,'92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','RER-SKU','Expiration Product',5,1000,1000,5000,0,0,5000,'BRL',repeat('a',64)),
  ('96000000-0000-4000-8000-00000000000b','91000000-0000-4000-8000-00000000000b',1,'92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','RER-SKU','Expiration Product',3,1000,1000,3000,0,0,3000,'BRL',repeat('b',64));
-- A: already expired (created 1h ago, expired 5 min ago -- expires_at > created_at
-- satisfies inventory_reservations_expiry_check while still being in the past
-- relative to now(), simulating a reservation whose window has since elapsed).
-- B: not yet expired (1 hour ahead).
insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,created_at,order_item_id) values
  ('97000000-0000-4000-8000-00000000000a','95000000-0000-4000-8000-000000000001',5,'active','order','order-a','rer-idem-a',now()-interval '5 minutes',now()-interval '1 hour','96000000-0000-4000-8000-00000000000a'),
  ('97000000-0000-4000-8000-00000000000b','95000000-0000-4000-8000-000000000001',3,'active','order','order-b','rer-idem-b',now()+interval '1 hour',now(),'96000000-0000-4000-8000-00000000000b');
update inventory_levels set quantity_reserved = quantity_reserved + 8 where id = '95000000-0000-4000-8000-000000000001';

select is((select count(*)::int from reclaim_expired_native_reservations(10,'test-worker')),1,'A1: exactly one reservation reclaimed in this batch');
select is((select status::text from inventory_reservations where id='97000000-0000-4000-8000-00000000000a'),'released','A1: reservation A released');
select is((select quantity_reserved from inventory_levels where id='95000000-0000-4000-8000-000000000001'),3::bigint,'A1: reserved decremented by exactly A''s quantity (B''s 3 remain)');
select is((select quantity_on_hand from inventory_levels where id='95000000-0000-4000-8000-000000000001'),100::bigint,'A1: on_hand unaffected by a release (only confirm decrements on_hand)');
select is((select status::text from inventory_reservations where id='97000000-0000-4000-8000-00000000000b'),'active','A8: non-expired reservation B left untouched');
select is((select status::text from orders where id='91000000-0000-4000-8000-00000000000a'),'pending','order A itself is not transitioned by expiration (only the reservation is)');

-- ---------- A2: same job repeated is idempotent -- exactly one logical release, no duplicate movement ----------
select is((select count(*)::int from reclaim_expired_native_reservations(10,'test-worker')),0,'A2 replay #1: nothing left to reclaim for A (already released)');
select is((select count(*)::int from reclaim_expired_native_reservations(10,'test-worker')),0,'A2 replay #2: still nothing (idempotent)');
select is((select count(*)::int from inventory_movements where reservation_id='97000000-0000-4000-8000-00000000000a' and movement_type='release'),1::int,'A2: exactly one release movement recorded despite 3 calls');
select is((select quantity_reserved from inventory_levels where id='95000000-0000-4000-8000-000000000001'),3::bigint,'A2: reserved unchanged by the replays');

-- ---------- A4/A9: a reservation already confirmed (paid) or already cancelled is never released, even past expires_at ----------
insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id) values
  ('91000000-0000-4000-8000-00000000000c','90000000-0000-4000-8000-000000000001',3,'RER-C','BRL',5000,5000,'Order C','order-c@example.invalid',gen_random_uuid()),
  ('91000000-0000-4000-8000-00000000000d','90000000-0000-4000-8000-000000000001',4,'RER-D','BRL',5000,5000,'Order D','order-d@example.invalid',gen_random_uuid());
insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values
  ('91000000-0000-4000-8000-00000000000c',null,'pending','system',gen_random_uuid()),
  ('91000000-0000-4000-8000-00000000000d',null,'pending','system',gen_random_uuid());
insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint) values
  ('96000000-0000-4000-8000-00000000000c','91000000-0000-4000-8000-00000000000c',1,'92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','RER-SKU','Expiration Product',2,1000,1000,2000,0,0,2000,'BRL',repeat('c',64)),
  ('96000000-0000-4000-8000-00000000000d',(select id from orders where order_number='RER-D'),1,'92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','RER-SKU','Expiration Product',1,1000,1000,1000,0,0,1000,'BRL',repeat('d',64));
insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,created_at,order_item_id,confirmed_at) values
  ('97000000-0000-4000-8000-00000000000c','95000000-0000-4000-8000-000000000001',2,'confirmed','order','order-c','rer-idem-c',now()-interval '5 minutes',now()-interval '1 hour','96000000-0000-4000-8000-00000000000c',now());
insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,created_at,order_item_id,released_at) values
  ('97000000-0000-4000-8000-00000000000d','95000000-0000-4000-8000-000000000001',1,'cancelled','order','order-d','rer-idem-d',now()-interval '5 minutes',now()-interval '1 hour','96000000-0000-4000-8000-00000000000d',now());

select is((select count(*)::int from reclaim_expired_native_reservations(10,'test-worker')),0,'A4/A9: neither a confirmed nor an already-cancelled reservation is a WHERE status=active candidate, even though both are past expires_at');
select is((select status::text from inventory_reservations where id='97000000-0000-4000-8000-00000000000c'),'confirmed','A4: PAID-confirmed reservation untouched by expiration');
select is((select status::text from inventory_reservations where id='97000000-0000-4000-8000-00000000000d'),'cancelled','A9: already-terminal reservation untouched by expiration');

-- ---------- A5: convergence when a verified payment arrives AFTER expiration already released the reservation ----------
insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id) values
  ('91000000-0000-4000-8000-00000000000e','90000000-0000-4000-8000-000000000001',5,'RER-E','BRL',5000,5000,'Order E','order-e@example.invalid',gen_random_uuid());
insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values
  ('91000000-0000-4000-8000-00000000000e',null,'pending','system',gen_random_uuid());
insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_discount_minor,line_tax_minor,line_total_minor,currency,source_fingerprint) values
  ('96000000-0000-4000-8000-00000000000e','91000000-0000-4000-8000-00000000000e',1,'92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','RER-SKU','Expiration Product',4,1000,1000,4000,0,0,4000,'BRL',repeat('e',64));
insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,created_at,order_item_id) values
  ('97000000-0000-4000-8000-00000000000e','95000000-0000-4000-8000-000000000001',4,'active','order','order-e','rer-idem-e',now()-interval '1 minute',now()-interval '1 hour','96000000-0000-4000-8000-00000000000e');
insert into payment_attempts(id,order_id,provider,method,amount_minor,currency,idempotency_key,status,version) values
  ('98000000-0000-4000-8000-00000000000e','91000000-0000-4000-8000-00000000000e','banco_inter','pix',4000,'BRL','rer-attempt-e','pending',1);
update inventory_levels set quantity_reserved = quantity_reserved + 4 where id = '95000000-0000-4000-8000-000000000001';

select is((select count(*)::int from reclaim_expired_native_reservations(10,'test-worker')),1,'A5 setup: reservation E reclaimed by expiration first');
select is((select status::text from inventory_reservations where id='97000000-0000-4000-8000-00000000000e'),'released','A5 setup: reservation E is released');

-- A late verified-payment arrival still converges: order transitions to confirmed,
-- but confirms zero reservations (none remain 'active') -- the documented
-- semantics from this migration's own header comment, not a crash or a
-- silently wrong count.
select lives_ok($$select apply_verified_payment_transition('98000000-0000-4000-8000-00000000000e','status_observed',null,'approved','paid')$$,'A5: late verified payment after expiration-release does not raise');
select is((select status::text from payment_attempts where id='98000000-0000-4000-8000-00000000000e'),'paid','A5: payment attempt still reaches paid on the ledger');
select is((select status::text from orders where id='91000000-0000-4000-8000-00000000000e'),'confirmed','A5: order still transitions to confirmed (documented convergence, not blocked)');
select is((select inventory_confirmed_count from apply_verified_payment_transition('98000000-0000-4000-8000-00000000000e','reconciliation_probe',null,'approved','paid')),0,'A5: replay confirms exactly zero reservations -- none remain active to confirm');
select is((select status::text from inventory_reservations where id='97000000-0000-4000-8000-00000000000e'),'released','A5: reservation E stays released, never resurrected to confirmed');

-- ---------- input validation ----------
select throws_ok($$select * from reclaim_expired_native_reservations(0,'test-worker')$$,'22023','invalid_batch_size','batch size of 0 rejected');
select throws_ok($$select * from reclaim_expired_native_reservations(1001,'test-worker')$$,'22023','invalid_batch_size','batch size over 1000 rejected');
select lives_ok($$select * from reclaim_expired_native_reservations()$$,'default batch size (100) is accepted with no candidates left');

select * from finish();
rollback;
