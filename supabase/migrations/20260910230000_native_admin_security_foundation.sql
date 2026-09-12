-- PIM-ADMIN-A2.1: server-controlled authorization; no credentials or seed data.
create table public.admin_memberships (
  id uuid primary key default gen_random_uuid(), identity_provider text not null, identity_subject text not null,
  role text not null check (role in ('ADMIN','PIM_REVIEWER','PIM_APPROVER')),
  status text not null default 'active' check (status in ('active','inactive','revoked')),
  created_by text not null, revoked_at timestamptz, revoked_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint admin_memberships_identity_not_blank check (btrim(identity_provider)<>'' and btrim(identity_subject)<>''),
  constraint admin_memberships_revocation_consistent check ((status='revoked' and revoked_at is not null and revoked_by is not null) or (status<>'revoked' and revoked_at is null and revoked_by is null))
);
create unique index admin_memberships_active_identity_unique on public.admin_memberships(identity_provider,identity_subject) where status='active';
create index admin_memberships_identity_lookup_idx on public.admin_memberships(identity_provider,identity_subject,status);
alter table public.admin_memberships enable row level security;
alter table public.admin_memberships force row level security;
alter table public.admin_memberships owner to postgres;

alter table public.pim_audit_log add column actor_identity_provider text, add column actor_identity_subject text,
  add column admin_membership_id uuid references public.admin_memberships(id) on delete restrict,
  add column effective_role text check (effective_role is null or effective_role in ('ADMIN','PIM_REVIEWER','PIM_APPROVER')),
  add column correlation_id uuid;
create index pim_audit_log_correlation_idx on public.pim_audit_log(correlation_id) where correlation_id is not null;

revoke all on table public.admin_memberships from public,anon,authenticated,persi_app,persi_worker,persi_readonly;
grant select on table public.admin_memberships to persi_app;
do $post$
declare r text; p text;
begin
 foreach r in array array['anon','authenticated'] loop foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
  if has_table_privilege(r,'public.admin_memberships',p) then raise exception using errcode='42501',message=format('ADMIN_MEMBERSHIP_BROWSER_PRIVILEGE:%s:%s',r,p); end if;
 end loop; end loop;
 if has_schema_privilege('anon','public','CREATE') or has_schema_privilege('authenticated','public','CREATE') then raise exception using errcode='42501',message='ADMIN_SECURITY_BROWSER_SCHEMA_CREATE'; end if;
end $post$;
comment on table public.admin_memberships is 'Server-only authorization memberships; contains no passwords, tokens, cookies, or MFA secrets.';
