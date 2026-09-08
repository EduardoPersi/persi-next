begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select has_function('public','canonical_checkout_price_fingerprint',array['uuid','bigint','bigint','timestamp with time zone','timestamp with time zone','timestamp with time zone','timestamp with time zone','character'],'canonical fingerprint exists');
select has_function('public','resolve_checkout_authoritative_price',array['uuid','uuid','character','timestamp with time zone'],'canonical resolver exists');
select function_lang_is('public','canonical_checkout_price_fingerprint',array['uuid','bigint','bigint','timestamp with time zone','timestamp with time zone','timestamp with time zone','timestamp with time zone','character'],'sql','fingerprint is SQL');
select volatility_is('public','canonical_checkout_price_fingerprint',array['uuid','bigint','bigint','timestamp with time zone','timestamp with time zone','timestamp with time zone','timestamp with time zone','character'],'immutable','fingerprint immutable');
select is(has_function_privilege('anon','public.resolve_checkout_authoritative_price(uuid,uuid,character,timestamp with time zone)','execute'),false,'anon cannot resolve price');
select is(has_function_privilege('authenticated','public.resolve_checkout_authoritative_price(uuid,uuid,character,timestamp with time zone)','execute'),false,'authenticated cannot resolve price');
select is(has_function_privilege('persi_app','public.resolve_checkout_authoritative_price(uuid,uuid,character,timestamp with time zone)','execute'),false,'app cannot call resolver directly');
select ok(position('v_as_oftimestamptz:=statement_timestamp()' in replace(pg_get_functiondef('public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text)'::regprocedure),' ',''))>0,'readiness captures one trusted as-of');
select ok(position('CHECKOUT_PRICE_STALE' in pg_get_functiondef('public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text)'::regprocedure))>0,'stale error deterministic');
select ok(position('resolve_checkout_authoritative_price' in pg_get_functiondef('public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text)'::regprocedure))>0,'readiness uses canonical resolver');
select ok(position('resolve_checkout_authoritative_price' in pg_get_functiondef('public.prepare_native_checkout(uuid,uuid,uuid,text,text,text,bigint,uuid,uuid,timestamp with time zone,boolean,text,uuid,public.external_system,text,text,text,bigint,text,text,text,text,timestamp with time zone,integer,text)'::regprocedure))>0,'prepare uses canonical resolver');
select ok(position('store_price_list_assignment_id' in pg_get_functiondef('public.prepare_native_checkout(uuid,uuid,uuid,text,text,text,bigint,uuid,uuid,timestamp with time zone,boolean,text,uuid,public.external_system,text,text,text,bigint,text,text,text,text,timestamp with time zone,integer,text)'::regprocedure))>0,'prepare binds assignment');
select ok(position('for key share' in lower(pg_get_functiondef('public.resolve_checkout_authoritative_price(uuid,uuid,character,timestamp with time zone)'::regprocedure)))>0,'resolver locks price row');
select ok(position('unit_regular_amount_minor' in pg_get_functiondef('public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text)'::regprocedure))>0,'regular amount defense in depth');
select ok(position('unit_effective_amount_minor' in pg_get_functiondef('public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text)'::regprocedure))>0,'effective amount defense in depth');
select ok(position('price_fingerprint' in pg_get_functiondef('public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text)'::regprocedure))>0,'fingerprint compared');
select ok(position('inventory_movements' in pg_get_functiondef('public.mark_native_checkout_ready(uuid,uuid,text,bigint,text)'::regprocedure))=0,'readiness writes no inventory movement');
select ok(position('update public.checkout_session_items' in lower(pg_get_functiondef('public.mark_native_checkout_ready(uuid,uuid,text,bigint,text)'::regprocedure)))=0,'readiness never reprices snapshot');

select * from finish();
rollback;
