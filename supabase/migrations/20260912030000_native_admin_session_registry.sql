-- PIM-ADMIN-A2.2B: server-controlled application sessions and revocation audit.
create table public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  identity_provider text not null check (identity_provider = 'supabase_auth'),
  identity_subject text not null check (btrim(identity_subject) <> ''),
  capability_hash text not null unique check (capability_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  idle_expires_at timestamptz not null,
  mfa_verified_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text,
  revoked_by_session_id uuid references public.admin_sessions(id) on delete restrict,
  constraint admin_sessions_expiry_valid check (expires_at > created_at and idle_expires_at <= expires_at),
  constraint admin_sessions_revocation_valid check ((revoked_at is null and revocation_reason is null) or (revoked_at is not null and btrim(revocation_reason) <> ''))
);
create index admin_sessions_subject_active_idx on public.admin_sessions(identity_provider,identity_subject,expires_at) where revoked_at is null;

create table public.admin_session_audit (
  id bigint generated always as identity primary key,
  admin_session_id uuid references public.admin_sessions(id) on delete restrict,
  actor_session_id uuid references public.admin_sessions(id) on delete restrict,
  identity_provider text not null,
  identity_subject text not null,
  membership_id uuid references public.admin_memberships(id) on delete restrict,
  effective_role text,
  operation text not null check (operation in ('session_established','session_revoked','sessions_revoked_all','logout','session_denied')),
  reason text,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);
create index admin_session_audit_subject_idx on public.admin_session_audit(identity_provider,identity_subject,created_at desc);

alter table public.admin_sessions enable row level security;
alter table public.admin_sessions force row level security;
alter table public.admin_session_audit enable row level security;
alter table public.admin_session_audit force row level security;
alter table public.admin_sessions owner to postgres;
alter table public.admin_session_audit owner to postgres;

revoke all on table public.admin_sessions, public.admin_session_audit from public,anon,authenticated,persi_worker,persi_readonly;
grant select,insert,update on table public.admin_sessions to persi_app;
grant select,insert on table public.admin_session_audit to persi_app;
grant usage,select on sequence public.admin_session_audit_id_seq to persi_app;
create policy admin_sessions_server_select on public.admin_sessions for select to persi_app using (true);
create policy admin_sessions_server_insert on public.admin_sessions for insert to persi_app with check (true);
create policy admin_sessions_server_update on public.admin_sessions for update to persi_app using (true) with check (true);
create policy admin_session_audit_server_select on public.admin_session_audit for select to persi_app using (true);
create policy admin_session_audit_server_insert on public.admin_session_audit for insert to persi_app with check (true);

do $security$
declare role_name text; privilege_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if has_table_privilege(role_name,'public.admin_sessions',privilege_name)
         or has_table_privilege(role_name,'public.admin_session_audit',privilege_name) then
        raise exception using errcode='42501',message='ADMIN_SESSION_BROWSER_PRIVILEGE';
      end if;
    end loop;
  end loop;
end
$security$;

comment on column public.admin_sessions.capability_hash is 'HMAC-SHA256 only; raw cookie and provider tokens are never stored.';
