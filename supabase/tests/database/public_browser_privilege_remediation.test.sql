begin;
select no_plan();

select is((
  select count(*)
  from pg_class relation
  join pg_namespace namespace on namespace.oid=relation.relnamespace
  cross join (values ('anon'),('authenticated')) browser(role_name)
  cross join (values ('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) dangerous(privilege_name)
  where namespace.nspname='public' and relation.relkind in ('r','p')
    and has_table_privilege(browser.role_name,relation.oid,dangerous.privilege_name)
),0::bigint,'browser roles have no dangerous public table privileges');

select is((
  select count(*)
  from pg_default_acl defaults
  join pg_namespace namespace on namespace.oid=defaults.defaclnamespace
  cross join lateral aclexplode(defaults.defaclacl) privilege
  where defaults.defaclrole='postgres'::regrole and namespace.nspname='public'
    and defaults.defaclobjtype='r'
    and pg_get_userbyid(privilege.grantee) in ('anon','authenticated')
    and privilege.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
),0::bigint,'postgres public table defaults are safe');

select is(has_schema_privilege('anon','public','CREATE'),false,'anon cannot create in public');
select is(has_schema_privilege('authenticated','public','CREATE'),false,'authenticated cannot create in public');

select is((
  select count(*)
  from unnest(array[
    'public.adjust_inventory(uuid,bigint,text,text,text)'::regprocedure,
    'public.capture_price_history()'::regprocedure,
    'public.catalog_search(text,integer)'::regprocedure,
    'public.confirm_inventory_reservation(uuid,text,text)'::regprocedure,
    'public.immutable_unaccent_lower(text)'::regprocedure,
    'public.prevent_overlapping_prices()'::regprocedure,
    'public.refresh_catalog_search_document(uuid)'::regprocedure,
    'public.release_inventory_reservation(uuid,text,text)'::regprocedure,
    'public.reserve_inventory(uuid,bigint,text,text,text,timestamptz,text)'::regprocedure,
    'public.rls_auto_enable()'::regprocedure,
    'public.set_updated_at()'::regprocedure,
    'public.validate_attribute_assignment()'::regprocedure,
    'public.validate_attribute_value_shape()'::regprocedure,
    'public.validate_measurement_component()'::regprocedure,
    'public.validate_product_media_variant()'::regprocedure,
    'public.validate_product_publication()'::regprocedure
  ]) target(function_oid)
  cross join (values ('anon'),('authenticated')) browser(role_name)
  where has_function_privilege(browser.role_name,target.function_oid,'EXECUTE')
),0::bigint,'browser roles cannot execute targeted server-only functions');

select is(has_function_privilege('anon','public.rls_auto_enable()','EXECUTE'),false,'anon cannot invoke ensure_rls function directly');
select is(has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE'),false,'authenticated cannot invoke ensure_rls function directly');

create table public.security_r1_rls_probe(id bigint);
select ok((select relrowsecurity from pg_class where oid='public.security_r1_rls_probe'::regclass),'ensure_rls still enables RLS');
select is(has_table_privilege('anon','public.security_r1_rls_probe','TRUNCATE'),false,'new table inherits safe browser defaults');
select is(has_table_privilege('authenticated','public.security_r1_rls_probe','MAINTAIN'),false,'new table has no browser maintain privilege');

select * from finish();
rollback;
