-- A3.7-A-R4: admin_memberships (20260910230000_native_admin_security_foundation.sql)
-- was created with RLS + FORCE RLS enabled and GRANT SELECT already given to
-- persi_app, but no RLS POLICY was ever added for it -- unlike its sibling
-- admin_sessions/admin_session_audit (20260912030000) and admin_rate_limits
-- (20260912040000) tables, which each correctly pair their GRANT with a
-- policy. Under Postgres RLS semantics, RLS+FORCE with no applicable policy
-- makes the table appear structurally empty to persi_app for every query,
-- regardless of real data. Proven live on persi-staging (A3.7-A-R3/R4): an
-- operator-created, correctly active PIM_APPROVER membership was invisible
-- to the app, and `select * from pg_policies where tablename='admin_memberships'`
-- returned 0 rows.
--
-- This migration is forward-only: it does not alter admin_memberships' table
-- definition, its RLS/FORCE RLS flags, or its existing GRANT -- it only adds
-- the missing policy, mirroring the exact already-established pattern used
-- for its sibling admin tables. No historical migration is modified.
create policy admin_memberships_server_select on public.admin_memberships for select to persi_app using (true);

-- Self-verifying guard (same convention already used in this table's own
-- original migration and in admin_session_registry.sql): re-confirm this
-- SELECT-only, persi_app-scoped policy did not grant the browser-facing
-- roles (anon/authenticated) any privilege on this table -- structurally
-- impossible given the `TO persi_app` scoping, asserted explicitly rather
-- than assumed.
do $security$
declare role_name text; privilege_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege(role_name,'public.admin_memberships',privilege_name) then
        raise exception using errcode='42501', message=format('ADMIN_MEMBERSHIP_BROWSER_PRIVILEGE:%s:%s', role_name, privilege_name);
      end if;
    end loop;
  end loop;
end
$security$;

-- Least-privilege guard: confirm this change did not (and does not) give
-- persi_app any mutation privilege on admin_memberships -- provisioning a
-- membership must continue to require an elevated, out-of-band connection
-- (e.g. the Supabase SQL editor's own privileged role), never the
-- application's own runtime role.
do $mutation_guard$
declare privilege_name text;
begin
  foreach privilege_name in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
    if has_table_privilege('persi_app','public.admin_memberships',privilege_name) then
      raise exception using errcode='42501', message=format('ADMIN_MEMBERSHIP_APP_MUTATION_PRIVILEGE:%s', privilege_name);
    end if;
  end loop;
end
$mutation_guard$;
