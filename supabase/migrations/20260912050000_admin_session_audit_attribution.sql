-- PIM-ADMIN-A2.2D-R1: preserve trusted native-session attribution in PIM audit.
-- Nullable only for legacy or explicitly non-admin audit rows created before this migration.
alter table public.pim_audit_log
  add column admin_session_id uuid references public.admin_sessions(id) on delete restrict;

create index pim_audit_log_admin_session_idx
  on public.pim_audit_log(admin_session_id, created_at desc)
  where admin_session_id is not null;

comment on column public.pim_audit_log.admin_session_id is
  'Trusted native admin session that authorized a protected PIM mutation; NULL denotes legacy or non-admin audit.';

do $security$
declare role_name text; privilege_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    foreach privilege_name in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege(role_name,'public.pim_audit_log',privilege_name) then
        raise exception using errcode='42501',message='PIM_AUDIT_BROWSER_WRITE_PRIVILEGE';
      end if;
    end loop;
  end loop;
end
$security$;
