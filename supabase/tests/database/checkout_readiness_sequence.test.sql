begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select has_function('public','mark_native_checkout_ready',array['uuid','uuid','text','bigint','text'],'readiness primitive exists');
select has_function('public','replace_native_checkout_shipping_quote',array['uuid','uuid','text','bigint','text','uuid','external_system','text','text','text','bigint','text','text','text','text','timestamp with time zone','integer','text'],'quote replacement primitive exists');
select is((select prosecdef from pg_proc where oid='public.mark_native_checkout_ready(uuid,uuid,text,bigint,text)'::regprocedure),true,'readiness is security definer');
select is((select prosecdef from pg_proc where oid='public.replace_native_checkout_shipping_quote(uuid,uuid,text,bigint,text,uuid,external_system,text,text,text,bigint,text,text,text,text,timestamptz,integer,text)'::regprocedure),true,'quote replacement is security definer');
select is(has_function_privilege('anon','public.mark_native_checkout_ready(uuid,uuid,text,bigint,text)','execute'),false,'anon cannot mark ready');
select is(has_function_privilege('authenticated','public.mark_native_checkout_ready(uuid,uuid,text,bigint,text)','execute'),false,'authenticated cannot mark ready');
select is(has_function_privilege('persi_worker','public.mark_native_checkout_ready(uuid,uuid,text,bigint,text)','execute'),false,'worker cannot mark ready');
select is(has_function_privilege('persi_app','public.mark_native_checkout_ready(uuid,uuid,text,bigint,text)','execute'),true,'app can mark ready');
select is(has_function_privilege('anon','public.replace_native_checkout_shipping_quote(uuid,uuid,text,bigint,text,uuid,external_system,text,text,text,bigint,text,text,text,text,timestamptz,integer,text)','execute'),false,'anon cannot replace quote');
select is(has_function_privilege('persi_app','public.replace_native_checkout_shipping_quote(uuid,uuid,text,bigint,text,uuid,external_system,text,text,text,bigint,text,text,text,text,timestamptz,integer,text)','execute'),true,'app can replace quote');
select ok(position('update public.checkout_sessions set status=''ready''' in pg_get_functiondef('public.prepare_native_checkout(uuid,uuid,uuid,text,text,text,bigint,uuid,uuid,timestamptz,boolean,text,uuid,external_system,text,text,text,bigint,text,text,text,text,timestamptz,integer,text)'::regprocedure))=0,'prepare no longer promotes ready');
select ok(position('s.status<>''validating''' in pg_get_functiondef('public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text)'::regprocedure))>0,'readiness requires validating');
select ok(position('CHECKOUT_PII_REQUIRED_OR_EXPIRED' in pg_get_functiondef('public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text)'::regprocedure))>0,'readiness requires valid PII');
select ok(position('CHECKOUT_SHIPPING_QUOTE_INVALID' in pg_get_functiondef('public.mark_native_checkout_ready(uuid,uuid,text,bigint,text)'::regprocedure))>0,'readiness validates shipping');
select ok(position('CHECKOUT_PRICE_STALE' in pg_get_functiondef('public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text)'::regprocedure))>0,'readiness validates current prices');
select ok(position('CHECKOUT_RESERVATION_INVALID' in pg_get_functiondef('public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text)'::regprocedure))>0,'readiness validates reservations');
select ok(position('CHECKOUT_VERSION_CONFLICT' in pg_get_functiondef('public.mark_native_checkout_ready_r1d_legacy(uuid,uuid,text,bigint,text)'::regprocedure))>0,'readiness is optimistic');
select ok(position('quantity_on_hand' in pg_get_functiondef('public.mark_native_checkout_ready(uuid,uuid,text,bigint,text)'::regprocedure))=0,'readiness does not mutate on hand');

select * from finish();
rollback;
