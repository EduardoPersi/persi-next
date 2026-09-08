begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table('public','checkout_shipping_evidence','evidence table exists');
select has_function('public','canonical_checkout_logistics_fingerprint',array['uuid','uuid','uuid','uuid','external_system','text','text','text','bigint','character','text','text','text','text','timestamp with time zone','timestamp with time zone','integer','text'],'canonical helper exists');
select has_function('public','create_native_shipping_evidence',array['uuid','uuid','text','bigint','text','uuid','external_system','text','text','text','bigint','text','text','text','timestamp with time zone','integer','text'],'creation primitive exists');
select has_function('public','replace_native_checkout_shipping_quote',array['uuid','uuid','text','bigint','uuid','text'],'evidence replacement exists');
select is((select relrowsecurity from pg_class where oid='public.checkout_shipping_evidence'::regclass),true,'RLS enabled');
select is(has_table_privilege('anon','public.checkout_shipping_evidence','insert'),false,'anon insert denied');
select is(has_table_privilege('authenticated','public.checkout_shipping_evidence','update'),false,'authenticated update denied');
select is(has_function_privilege('anon','public.create_native_shipping_evidence(uuid,uuid,text,bigint,text,uuid,external_system,text,text,text,bigint,text,text,text,timestamptz,integer,text)','execute'),false,'anon creation denied');
select is(has_function_privilege('persi_app','public.create_native_shipping_evidence(uuid,uuid,text,bigint,text,uuid,external_system,text,text,text,bigint,text,text,text,timestamptz,integer,text)','execute'),true,'app creation allowed');
select is((select count(*) from pg_trigger where tgname='checkout_shipping_evidence_immutable'),1::bigint,'immutability trigger exists');
select is((select count(*) from pg_constraint where conname='checkout_shipping_evidence_id_checkout_unique'),1::bigint,'composite unique exists');
select is((select count(*) from pg_constraint where conname='checkout_shipping_quotes_evidence_fk'),1::bigint,'composite FK exists');
select ok(canonical_checkout_logistics_fingerprint(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,'melhor_envio','svc','carrier','service',100,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1','2026-09-05 12:00+00','2026-09-05 13:00+00',null,null) is not null,'all optional NULL hashes');
select ok(canonical_checkout_logistics_fingerprint('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003',null,'melhor_envio','svc','carrier','service',100,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1','2026-09-05 12:00+00','2026-09-05 13:00+00',null,null)=canonical_checkout_logistics_fingerprint('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003',null,'melhor_envio','svc','carrier','service',100,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1','2026-09-05 12:00+00','2026-09-05 13:00+00',null,null),'fingerprint deterministic');
select isnt(canonical_checkout_logistics_fingerprint('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003',null,'melhor_envio','svc','carrier','service',100,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1','2026-09-05 12:00+00','2026-09-05 13:00+00',null,null),canonical_checkout_logistics_fingerprint('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003',null,'melhor_envio','svc','carrier','service',101,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1','2026-09-05 12:00+00','2026-09-05 13:00+00',null,null),'amount bound');
select throws_ok($$select canonical_checkout_logistics_fingerprint(null,gen_random_uuid(),gen_random_uuid(),null,'melhor_envio','svc','carrier','service',100,'BRL','13201000',repeat('a',64),repeat('b',64),'shipping-authority-v1',now(),now()+interval '1 hour',null,null)$$,'22023','INVALID_SHIPPING_FINGERPRINT_INPUT','mandatory NULL rejected');
select ok(position('r1d_shipping_quote_is_authoritative' in pg_get_functiondef('public.mark_native_checkout_ready(uuid,uuid,text,bigint,text)'::regprocedure))>0,'readiness calls authority helper');
select ok(position('canonical_checkout_logistics_fingerprint' in pg_get_functiondef('public.r1d_shipping_quote_is_authoritative(uuid,uuid,character,text,timestamptz)'::regprocedure))>0,'readiness recomputes fingerprint');
select is(has_function_privilege('persi_app','public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text)','execute'),false,'legacy bypass revoked');
select ok(position('shipping_required' in pg_get_functiondef('public.mark_native_checkout_ready(uuid,uuid,text,bigint,text)'::regprocedure))>0,'shipping optionality preserved');

select * from finish();
rollback;
