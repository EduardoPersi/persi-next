-- SECURITY-R1: remove unintended browser privileges inherited from Supabase
-- defaults. This migration is intentionally positioned after the current
-- staging head (20260903120000) and before the unapplied B3C sequence.

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;

revoke truncate, references, trigger, maintain on all tables in schema public
  from anon, authenticated;

revoke execute on function
  public.adjust_inventory(uuid,bigint,text,text,text),
  public.capture_price_history(),
  public.catalog_search(text,integer),
  public.confirm_inventory_reservation(uuid,text,text),
  public.immutable_unaccent_lower(text),
  public.prevent_overlapping_prices(),
  public.refresh_catalog_search_document(uuid),
  public.release_inventory_reservation(uuid,text,text),
  public.reserve_inventory(uuid,bigint,text,text,text,timestamptz,text),
  public.rls_auto_enable(),
  public.set_updated_at(),
  public.validate_attribute_assignment(),
  public.validate_attribute_value_shape(),
  public.validate_measurement_component(),
  public.validate_product_media_variant(),
  public.validate_product_publication()
from public, anon, authenticated;

do $security_postconditions$
declare
  role_name text;
  privilege_name text;
  target_function regprocedure;
  target_functions constant regprocedure[] := array[
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
  ];
begin
  foreach role_name in array array['anon','authenticated'] loop
    foreach privilege_name in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if exists (
        select 1
        from pg_catalog.pg_class relation
        join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
        where namespace.nspname='public'
          and relation.relkind in ('r','p')
          and pg_catalog.has_table_privilege(role_name,relation.oid,privilege_name)
      ) then
        raise exception using errcode='42501',
          message=format('SECURITY_BROWSER_TABLE_PRIVILEGE_REMAINS:%s:%s',role_name,privilege_name);
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_default_acl defaults
    join pg_catalog.pg_namespace namespace on namespace.oid=defaults.defaclnamespace
    cross join lateral pg_catalog.aclexplode(defaults.defaclacl) privilege
    where defaults.defaclrole='postgres'::regrole
      and namespace.nspname='public'
      and defaults.defaclobjtype='r'
      and pg_catalog.pg_get_userbyid(privilege.grantee) in ('anon','authenticated')
      and privilege.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
  ) then
    raise exception using errcode='42501',message='SECURITY_UNSAFE_POSTGRES_TABLE_DEFAULT_REMAINS';
  end if;

  if pg_catalog.has_schema_privilege('anon','public','CREATE')
     or pg_catalog.has_schema_privilege('authenticated','public','CREATE') then
    raise exception using errcode='42501',message='SECURITY_BROWSER_SCHEMA_CREATE_REMAINS';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(relation.relacl,pg_catalog.acldefault('r',relation.relowner))
    ) privilege
    where namespace.nspname='public'
      and relation.relkind in ('r','p')
      and privilege.grantee=0
      and privilege.privilege_type in
        ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
  ) then
    raise exception using errcode='42501',message='SECURITY_PUBLIC_TABLE_MUTATION_REMAINS';
  end if;

  foreach target_function in array target_functions loop
    if pg_catalog.has_function_privilege('anon',target_function,'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated',target_function,'EXECUTE')
       or exists (
         select 1
         from pg_catalog.pg_proc function
         cross join lateral pg_catalog.aclexplode(
           coalesce(function.proacl,pg_catalog.acldefault('f',function.proowner))
         ) privilege
         where function.oid=target_function
           and privilege.grantee=0
           and privilege.privilege_type='EXECUTE'
       ) then
      raise exception using errcode='42501',
        message=format('SECURITY_BROWSER_FUNCTION_EXECUTE_REMAINS:%s',target_function::text);
    end if;
  end loop;
end
$security_postconditions$;

comment on function public.rls_auto_enable() is
  'Internal ensure_rls event-trigger function; direct browser and PUBLIC execution is revoked.';
