begin;
select plan(8);

select has_function(
  'public',
  'submit_native_checkout',
  array['uuid','bigint','text','text','uuid','text','text','text','uuid','uuid','text','text','text','jsonb','jsonb','text','text','text','text'],
  'M31 preserves the canonical submit signature'
);

select is(
  (select prosecdef from pg_proc where oid='public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)'::regprocedure),
  true,
  'submit remains SECURITY DEFINER'
);

select is(
  (select proconfig from pg_proc where oid='public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)'::regprocedure),
  array['search_path=""']::text[],
  'submit retains an empty search_path'
);

select is(
  (select r.rolname from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)'::regprocedure),
  'postgres',
  'submit remains owned by postgres'
);

select ok(has_function_privilege('persi_app','public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)','EXECUTE'),'persi_app retains EXECUTE');
select ok(not has_function_privilege('persi_worker','public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)','EXECUTE'),'persi_worker cannot execute submit');
select ok(not has_function_privilege('anon','public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)','EXECUTE'),'anon cannot execute submit');
select ok(position('is not true' in lower(pg_get_functiondef('public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)'::regprocedure)))>0,'authority predicate is explicitly null-safe and fail-closed');

select * from finish();
rollback;
