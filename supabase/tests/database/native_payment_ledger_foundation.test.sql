begin;
select no_plan();

-- ---------- schema shape ----------
select has_type('public','payment_provider','provider enum');
select has_type('public','payment_method','method enum');
select has_type('public','payment_attempt_status','attempt status enum');
select has_type('public','payment_event_type','event type enum');
select has_type('public','payment_event_processing_result','processing result enum');
select has_type('public','refund_status','refund status enum');
select has_table('public','payment_attempts','payment attempts exists');
select has_table('public','payment_events','payment events exists');
select has_table('public','refunds','refunds exists');
select col_type_is('public','payment_attempts','amount_minor','bigint','amount bigint');
select col_type_is('public','payment_attempts','version','bigint','version bigint');
select col_type_is('public','refunds','requested_amount_minor','bigint','refund amount bigint');
select col_is_pk('public','payment_attempts','id','attempts PK');
select col_is_pk('public','payment_events','id','events PK');
select col_is_pk('public','refunds','id','refunds PK');
select fk_ok('public','payment_attempts','order_id','public','orders','id','attempt order FK');
select fk_ok('public','payment_events','payment_attempt_id','public','payment_attempts','id','event attempt FK');
select fk_ok('public','refunds','payment_attempt_id','public','payment_attempts','id','refund attempt FK');
select fk_ok('public','refunds','order_id','public','orders','id','refund order FK');
select has_index('public','payment_attempts','payment_attempts_idempotency_unique','attempt idempotency unique');
select has_index('public','payment_attempts','payment_attempts_provider_reference_unique','attempt provider reference unique');
select has_index('public','payment_events','payment_events_external_dedupe_unique','event dedupe unique');
select has_index('public','refunds','refunds_idempotency_unique','refund idempotency unique');

-- ---------- security: RLS + zero dangerous browser privileges ----------
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('payment_attempts'::regclass,'payment_events'::regclass,'refunds'::regclass)),'RLS 3/3');
select is((select count(*) from pg_policies where schemaname='public' and tablename in ('payment_attempts','payment_events','refunds') and ('public'=any(roles) or 'anon'=any(roles) or 'authenticated'=any(roles))),0::bigint,'zero browser policies');
select is(has_table_privilege('anon','public.payment_attempts','select'),false,'anon blocked from attempts');
select is(has_table_privilege('authenticated','public.payment_events','select'),false,'authenticated blocked from events');
select is(has_table_privilege('anon','public.refunds','select'),false,'anon blocked from refunds');
select is(has_table_privilege('persi_app','public.payment_attempts','update'),false,'app cannot update attempts directly');
select is(has_table_privilege('persi_app','public.payment_events','insert'),false,'app cannot insert events directly');
select is(has_table_privilege('persi_app','public.refunds','update'),false,'app cannot update refunds directly');
select is(has_table_privilege('persi_app','public.payment_attempts','delete'),false,'app cannot delete attempts');
-- persi_app MAY create (initiate) an attempt/refund -- that is the one
-- legitimate customer-triggered action Section 15 allows.
select is(has_function_privilege('persi_app','public.create_native_payment_attempt(uuid,payment_provider,payment_method,bigint,char,text,timestamptz)','execute'),true,'app can create attempt');
select is(has_function_privilege('persi_app','public.create_native_refund(uuid,uuid,payment_provider,bigint,char,text,text)','execute'),true,'app can create refund');
-- persi_app must NEVER be able to move a payment/refund forward -- only
-- persi_worker (webhook/reconciliation backend authority) can.
select is(has_function_privilege('persi_app','public.transition_native_payment_attempt(uuid,payment_attempt_status,payment_attempt_status,bigint,text,text,text,text)','execute'),false,'app cannot transition attempts');
select is(has_function_privilege('persi_app','public.record_native_payment_event(uuid,payment_provider,payment_event_type,text,text,payment_attempt_status,text)','execute'),false,'app cannot record events');
select is(has_function_privilege('persi_app','public.transition_native_refund(uuid,refund_status,refund_status,text)','execute'),false,'app cannot transition refunds');
select is(has_function_privilege('persi_worker','public.transition_native_payment_attempt(uuid,payment_attempt_status,payment_attempt_status,bigint,text,text,text,text)','execute'),true,'worker can transition attempts');
select is(has_function_privilege('persi_worker','public.record_native_payment_event(uuid,payment_provider,payment_event_type,text,text,payment_attempt_status,text)','execute'),true,'worker can record events');
select is(has_function_privilege('anon','public.create_native_payment_attempt(uuid,payment_provider,payment_method,bigint,char,text,timestamptz)','execute'),false,'anon fully blocked');

-- ---------- fixtures: real stores + orders to attach payments to ----------
insert into stores(id,code,name,status) values
  ('51000000-0000-4000-8000-000000000001','pld1','Payment Ledger Store 1','active'),
  ('51000000-0000-4000-8000-000000000002','pld2','Payment Ledger Store 2','active'),
  ('51000000-0000-4000-8000-000000000003','pld3','Payment Ledger Store 3','active'),
  ('51000000-0000-4000-8000-000000000004','pld4','Payment Ledger Store 4','active');
insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email,correlation_id) values
  ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',1,'PLD1-TEST-1','BRL',10000,10000,'Payment Test 1','payment1@example.invalid','53000000-0000-4000-8000-000000000001'),
  ('52000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002',1,'PLD2-TEST-1','BRL',5000,5000,'Payment Test 2','payment2@example.invalid','53000000-0000-4000-8000-000000000002'),
  ('52000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000003',1,'PLD3-TEST-1','BRL',8000,8000,'Payment Test 3','payment3@example.invalid','53000000-0000-4000-8000-000000000003'),
  ('52000000-0000-4000-8000-000000000004','51000000-0000-4000-8000-000000000004',1,'PLD4-TEST-1','BRL',3000,3000,'Payment Test 4','payment4@example.invalid','53000000-0000-4000-8000-000000000004');
-- orders_initial_event_required (native_checkout_order_integrity_hardening,
-- a DEFERRED constraint trigger) needs exactly this row per order -- it
-- never actually fires inside this file's rollback-wrapped transaction,
-- but every fixture here still follows the same convention
-- native_order_foundation.test.sql itself uses, for fidelity.
insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values
  ('52000000-0000-4000-8000-000000000001',null,'pending','system',gen_random_uuid()),
  ('52000000-0000-4000-8000-000000000002',null,'pending','system',gen_random_uuid()),
  ('52000000-0000-4000-8000-000000000003',null,'pending','system',gen_random_uuid()),
  ('52000000-0000-4000-8000-000000000004',null,'pending','system',gen_random_uuid());

-- ---------- idempotent creation ----------
select is((select id from create_native_payment_attempt('52000000-0000-4000-8000-000000000001','mercado_pago','credit_card',10000,'BRL','idem-key-1')),
  (select id from create_native_payment_attempt('52000000-0000-4000-8000-000000000001','mercado_pago','credit_card',10000,'BRL','idem-key-1')),
  'same idempotency key returns same attempt row');
select is((select count(*) from payment_attempts where idempotency_key='idem-key-1'),1::bigint,'exactly one row for the idempotency key despite two calls');
select throws_ok($$insert into payment_attempts(order_id,provider,method,amount_minor,currency,idempotency_key) values('52000000-0000-4000-8000-000000000001','mercado_pago','credit_card',10000,'BRL','idem-key-1')$$,'23505',null,'raw insert still blocked by the same unique constraint');

-- ---------- state machine: valid + invalid transitions (pix -- no separate authorization step) ----------
insert into payment_attempts(id,order_id,provider,method,amount_minor,currency,idempotency_key) values
  ('61000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000002','banco_inter','pix',5000,'BRL','idem-key-2');
select lives_ok($$select transition_native_payment_attempt('61000000-0000-4000-8000-000000000001','created','pending',0)$$,'created->pending allowed');
select lives_ok($$select transition_native_payment_attempt('61000000-0000-4000-8000-000000000001','pending','paid',1)$$,'pending->paid allowed (pix has no separate authorization step)');
select is((select status::text from payment_attempts where id='61000000-0000-4000-8000-000000000001'),'paid','status is now paid');
select is((select paid_at is not null from payment_attempts where id='61000000-0000-4000-8000-000000000001'),true,'paid_at populated');
select throws_ok($$select transition_native_payment_attempt('61000000-0000-4000-8000-000000000001','paid','pending',2)$$,'23514','invalid_payment_attempt_status_transition','paid cannot go back to pending');
select throws_ok($$select transition_native_payment_attempt('61000000-0000-4000-8000-000000000001','created','pending',0)$$,'40001','stale_payment_attempt_transition','stale expected-version rejected');
select throws_ok($$update payment_attempts set status='failed' where id='61000000-0000-4000-8000-000000000001'$$,'23514','invalid_payment_attempt_status_transition','direct UPDATE still goes through the trigger, not just the function');

-- ---------- state machine: card-shaped (has a separate authorization step) ----------
insert into payment_attempts(id,order_id,provider,method,amount_minor,currency,idempotency_key) values
  ('61000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000003','pagbank','apple_pay',8000,'BRL','idem-key-3');
select lives_ok($$select transition_native_payment_attempt('61000000-0000-4000-8000-000000000002','created','pending',0)$$,'card: created->pending');
select lives_ok($$select transition_native_payment_attempt('61000000-0000-4000-8000-000000000002','pending','authorized',1)$$,'card: pending->authorized');
select lives_ok($$select transition_native_payment_attempt('61000000-0000-4000-8000-000000000002','authorized','failed',2,null,null,'insufficient_funds','Cartao recusado pelo emissor')$$,'card: authorized->failed');
select is((select failure_code from payment_attempts where id='61000000-0000-4000-8000-000000000002'),'insufficient_funds','failure code recorded');
select is((select failed_at is not null from payment_attempts where id='61000000-0000-4000-8000-000000000002'),true,'failed_at populated');

-- ---------- event dedupe ----------
insert into payment_attempts(id,order_id,provider,method,amount_minor,currency,idempotency_key,status,version) values
  ('61000000-0000-4000-8000-000000000004','52000000-0000-4000-8000-000000000004','mercado_pago','credit_card',3000,'BRL','idem-key-4','pending',1);
select is((select processing_result::text from record_native_payment_event('61000000-0000-4000-8000-000000000004','mercado_pago','webhook_received','ext-evt-1','approved','paid')),'applied','first delivery applied');
select is((select status::text from payment_attempts where id='61000000-0000-4000-8000-000000000004'),'paid','event advanced the attempt to paid');
select is((select count(*) from payment_events where external_event_id='ext-evt-1'),1::bigint,'exactly one event row so far');
select is((select processing_result::text from record_native_payment_event('61000000-0000-4000-8000-000000000004','mercado_pago','webhook_received','ext-evt-1','approved','paid')),'applied','duplicate delivery returns the SAME already-applied row');
select is((select count(*) from payment_events where external_event_id='ext-evt-1'),1::bigint,'still exactly one event row after 3 total deliveries -- dedupe held');
select is((select processing_result::text from record_native_payment_event('61000000-0000-4000-8000-000000000004','mercado_pago','webhook_received','ext-evt-1','approved','paid')),'applied','third delivery still returns the same row');
-- a late, stale event trying to move an already-paid attempt backwards to
-- pending must never succeed -- recorded for audit, but never applied.
select is((select processing_result::text from record_native_payment_event('61000000-0000-4000-8000-000000000004','mercado_pago','webhook_received','ext-evt-2','pending','pending')),'stale_ignored','stale backward event is ignored, not applied');
select is((select status::text from payment_attempts where id='61000000-0000-4000-8000-000000000004'),'paid','attempt status unaffected by the stale event');
select is((select count(*) from payment_events where payment_attempt_id='61000000-0000-4000-8000-000000000004'),2::bigint,'two distinct external events recorded (ext-evt-1 dedup group + ext-evt-2), never three+ for ext-evt-1 alone');
-- internally-generated events (no external id) never collide with each other.
select lives_ok($$select record_native_payment_event('61000000-0000-4000-8000-000000000004','mercado_pago','reconciliation_probe',null,'approved','paid')$$,'first null-external-id probe');
select lives_ok($$select record_native_payment_event('61000000-0000-4000-8000-000000000004','mercado_pago','reconciliation_probe',null,'approved','paid')$$,'second null-external-id probe does not collide with the first');

-- ---------- immutability ----------
select throws_ok($$update payment_events set observed_status='tampered' where external_event_id='ext-evt-1'$$,'23514','payment_event_immutable','events append-only');
select throws_ok($$delete from payment_events where external_event_id='ext-evt-1'$$,'23514','payment_history_delete_forbidden','events cannot be deleted');
select throws_ok($$update payment_attempts set amount_minor=1 where id='61000000-0000-4000-8000-000000000004'$$,'23514','payment_attempt_commercial_snapshot_immutable','commercial snapshot fields immutable');

-- ---------- refunds: idempotency + ceiling ----------
-- Fixed ids (like every payment_attempts fixture above) instead of
-- capturing create_native_refund's own generated id -- simpler and
-- consistent with this file's own established convention; the idempotent-
-- creation CONTRACT itself is already covered by the two-calls-compared
-- assertion below and by the earlier payment_attempts equivalent.
insert into refunds(id,payment_attempt_id,order_id,provider,requested_amount_minor,currency,idempotency_key) values
  ('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000004','52000000-0000-4000-8000-000000000004','mercado_pago',1000,'BRL','refund-idem-1');
select is((select id from create_native_refund('61000000-0000-4000-8000-000000000004','52000000-0000-4000-8000-000000000004','mercado_pago',1000,'BRL','refund-idem-1')),
  '62000000-0000-4000-8000-000000000001'::uuid,
  'create_native_refund with an EXISTING idempotency key returns the existing row instead of inserting a second one');
select is((select count(*) from refunds where idempotency_key='refund-idem-1'),1::bigint,'still exactly one row for that idempotency key');
select lives_ok($$select transition_native_refund('62000000-0000-4000-8000-000000000001','requested','processing')$$,'refund requested->processing');
select lives_ok($$select transition_native_refund('62000000-0000-4000-8000-000000000001','processing','completed')$$,'refund processing->completed');
select is((select status::text from payment_attempts where id='61000000-0000-4000-8000-000000000004'),'partially_refunded','partial refund reflected on the attempt (1000 of 3000)');
-- a second refund that would push the total over the original amount must
-- be rejected -- 1000 (completed) + 2500 (new) = 3500 > 3000.
select throws_ok($$insert into refunds(payment_attempt_id,order_id,provider,requested_amount_minor,currency,idempotency_key) values('61000000-0000-4000-8000-000000000004','52000000-0000-4000-8000-000000000004','mercado_pago',2500,'BRL','refund-idem-2')$$,'23514','refund_amount_exceeds_payment_attempt','over-ceiling refund rejected at insert');
-- a refund that exactly completes the remaining balance flips the attempt
-- to fully refunded.
insert into refunds(id,payment_attempt_id,order_id,provider,requested_amount_minor,currency,idempotency_key) values
  ('62000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000004','52000000-0000-4000-8000-000000000004','mercado_pago',2000,'BRL','refund-idem-3');
select transition_native_refund('62000000-0000-4000-8000-000000000003','requested','processing');
select transition_native_refund('62000000-0000-4000-8000-000000000003','processing','completed');
select is((select status::text from payment_attempts where id='61000000-0000-4000-8000-000000000004'),'refunded','fully refunded once the remaining 2000 completes');
select throws_ok($$update refunds set status='requested' where id='62000000-0000-4000-8000-000000000001'$$,'23514','invalid_refund_status_transition','completed refund cannot be rewound to requested, even via a raw UPDATE bypassing transition_native_refund');
select throws_ok($$update refunds set requested_amount_minor=1 where id='62000000-0000-4000-8000-000000000001'$$,'23514','refund_commercial_snapshot_immutable','refund commercial snapshot fields immutable');

select * from finish();
rollback;
