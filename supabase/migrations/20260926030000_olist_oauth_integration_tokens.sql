-- Olist Fase 1 (read-only) -- encrypted OAuth token storage for the two
-- "Aplicativos" v3 (Catalogo, Pedidos).
--
-- Design: docs/native-commerce/olist-oauth-flow-design.md Sections 4-5.
-- NOT APPLIED to any real Supabase project by this round.
--
-- Postgres NEVER sees a plaintext access or refresh token -- only the
-- AES-256-GCM envelope (ciphertext/iv/authTag/keyId), encrypted/decrypted
-- application-side by lib/commerce/olistOAuthTokenCrypto.ts, mirroring
-- (as its own independent implementation, not a shared module) the pattern
-- already proven for checkout PII in lib/commerce/checkoutPii.ts.
--
-- Concurrency, per the owner's explicit condition: no HTTP call to Olist
-- ever happens inside a Postgres transaction/lock. Refresh coordination is
-- therefore a "claim, release immediately, do the HTTP call unlocked,
-- write back with an ownership check" pattern -- claim_oauth_token_refresh
-- and write_oauth_integration_token are each a single standalone
-- statement, never held open around the token-endpoint call.
create table public.oauth_integration_tokens (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'olist'),
  app text not null check (app in ('catalogo', 'pedidos')),
  environment text not null check (environment in ('staging', 'production')),

  access_ciphertext text,
  access_iv text,
  access_auth_tag text,
  access_key_id text,
  access_expires_at timestamptz,

  refresh_ciphertext text,
  refresh_iv text,
  refresh_auth_tag text,
  refresh_key_id text,
  refresh_expires_at timestamptz,

  envelope_version integer not null default 1 check (envelope_version >= 1),

  refresh_claimed_by text,
  refresh_claimed_at timestamptz,

  version bigint not null default 0 check (version >= 0),
  last_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint oauth_integration_tokens_unique unique (provider, app, environment)
);

alter table public.oauth_integration_tokens enable row level security;
alter table public.oauth_integration_tokens force row level security;
alter table public.oauth_integration_tokens owner to postgres;

-- Initial write (Section 2 of the OAuth flow doc: the owner's one-time
-- browser authorization) and a full re-authorization both go through this
-- -- unconditional upsert, no claim needed since there is no concurrent
-- refresh to race against the very first grant.
create function public.upsert_oauth_integration_token(
  p_provider text,
  p_app text,
  p_environment text,
  p_access_ciphertext text,
  p_access_iv text,
  p_access_auth_tag text,
  p_access_key_id text,
  p_access_expires_at timestamptz,
  p_refresh_ciphertext text,
  p_refresh_iv text,
  p_refresh_auth_tag text,
  p_refresh_key_id text,
  p_refresh_expires_at timestamptz,
  p_envelope_version integer
)
returns public.oauth_integration_tokens
language sql
security definer
set search_path = ''
as $$
  insert into public.oauth_integration_tokens (
    provider, app, environment,
    access_ciphertext, access_iv, access_auth_tag, access_key_id, access_expires_at,
    refresh_ciphertext, refresh_iv, refresh_auth_tag, refresh_key_id, refresh_expires_at,
    envelope_version, last_refreshed_at
  ) values (
    p_provider, p_app, p_environment,
    p_access_ciphertext, p_access_iv, p_access_auth_tag, p_access_key_id, p_access_expires_at,
    p_refresh_ciphertext, p_refresh_iv, p_refresh_auth_tag, p_refresh_key_id, p_refresh_expires_at,
    p_envelope_version, now()
  )
  on conflict (provider, app, environment) do update set
    access_ciphertext = excluded.access_ciphertext,
    access_iv = excluded.access_iv,
    access_auth_tag = excluded.access_auth_tag,
    access_key_id = excluded.access_key_id,
    access_expires_at = excluded.access_expires_at,
    refresh_ciphertext = excluded.refresh_ciphertext,
    refresh_iv = excluded.refresh_iv,
    refresh_auth_tag = excluded.refresh_auth_tag,
    refresh_key_id = excluded.refresh_key_id,
    refresh_expires_at = excluded.refresh_expires_at,
    envelope_version = excluded.envelope_version,
    refresh_claimed_by = null,
    refresh_claimed_at = null,
    version = public.oauth_integration_tokens.version + 1,
    last_refreshed_at = now(),
    updated_at = now()
  returning *;
$$;

alter function public.upsert_oauth_integration_token(text, text, text, text, text, text, text, timestamptz, text, text, text, text, timestamptz, integer) owner to postgres;
revoke all on function public.upsert_oauth_integration_token(text, text, text, text, text, text, text, timestamptz, text, text, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.upsert_oauth_integration_token(text, text, text, text, text, text, text, timestamptz, text, text, text, text, timestamptz, integer) to persi_app, persi_worker;

create function public.read_oauth_integration_token(p_provider text, p_app text, p_environment text)
returns public.oauth_integration_tokens
language sql
security definer
stable
set search_path = ''
as $$
  select * from public.oauth_integration_tokens
  where provider = p_provider and app = p_app and environment = p_environment;
$$;

alter function public.read_oauth_integration_token(text, text, text) owner to postgres;
revoke all on function public.read_oauth_integration_token(text, text, text) from public, anon, authenticated;
grant execute on function public.read_oauth_integration_token(text, text, text) to persi_app, persi_worker;

-- Standalone, autocommitted claim -- returns true only if this caller now
-- owns the refresh (no existing unexpired claim). The caller must NOT wrap
-- this in the same transaction as the following HTTP call to Olist; call
-- it, get the result, then make the HTTP call with no open transaction.
create function public.claim_oauth_token_refresh(
  p_provider text,
  p_app text,
  p_environment text,
  p_claimant text,
  p_lease_seconds integer
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.oauth_integration_tokens
  set refresh_claimed_by = p_claimant, refresh_claimed_at = clock_timestamp()
  where provider = p_provider and app = p_app and environment = p_environment
    and (refresh_claimed_at is null or refresh_claimed_at < clock_timestamp() - make_interval(secs => p_lease_seconds))
  returning true;
$$;

alter function public.claim_oauth_token_refresh(text, text, text, text, integer) owner to postgres;
revoke all on function public.claim_oauth_token_refresh(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_oauth_token_refresh(text, text, text, text, integer) to persi_app, persi_worker;

-- Failure cleanup: the HTTP call to Olist failed after a successful claim.
-- Releases early instead of making the next attempt wait out the full
-- lease -- only releases if still owned by this claimant.
create function public.release_oauth_token_refresh_claim(p_provider text, p_app text, p_environment text, p_claimant text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.oauth_integration_tokens
  set refresh_claimed_by = null, refresh_claimed_at = null
  where provider = p_provider and app = p_app and environment = p_environment
    and refresh_claimed_by = p_claimant;
$$;

alter function public.release_oauth_token_refresh_claim(text, text, text, text) owner to postgres;
revoke all on function public.release_oauth_token_refresh_claim(text, text, text, text) from public, anon, authenticated;
grant execute on function public.release_oauth_token_refresh_claim(text, text, text, text) to persi_app, persi_worker;

-- Writes the refreshed token back, but only if this caller still owns the
-- claim -- if the lease expired and another process already claimed and
-- wrote its own refresh, this returns false and the caller must discard
-- its own result and re-read (read_oauth_integration_token) instead of
-- overwriting a newer token with a stale one.
create function public.write_oauth_integration_token(
  p_provider text,
  p_app text,
  p_environment text,
  p_claimant text,
  p_access_ciphertext text,
  p_access_iv text,
  p_access_auth_tag text,
  p_access_key_id text,
  p_access_expires_at timestamptz,
  p_refresh_ciphertext text,
  p_refresh_iv text,
  p_refresh_auth_tag text,
  p_refresh_key_id text,
  p_refresh_expires_at timestamptz,
  p_envelope_version integer
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.oauth_integration_tokens
  set access_ciphertext = p_access_ciphertext,
      access_iv = p_access_iv,
      access_auth_tag = p_access_auth_tag,
      access_key_id = p_access_key_id,
      access_expires_at = p_access_expires_at,
      refresh_ciphertext = p_refresh_ciphertext,
      refresh_iv = p_refresh_iv,
      refresh_auth_tag = p_refresh_auth_tag,
      refresh_key_id = p_refresh_key_id,
      refresh_expires_at = p_refresh_expires_at,
      envelope_version = p_envelope_version,
      refresh_claimed_by = null,
      refresh_claimed_at = null,
      version = version + 1,
      last_refreshed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where provider = p_provider and app = p_app and environment = p_environment
    and refresh_claimed_by = p_claimant
  returning true;
$$;

alter function public.write_oauth_integration_token(text, text, text, text, text, text, text, text, timestamptz, text, text, text, text, timestamptz, integer) owner to postgres;
revoke all on function public.write_oauth_integration_token(text, text, text, text, text, text, text, text, timestamptz, text, text, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.write_oauth_integration_token(text, text, text, text, text, text, text, text, timestamptz, text, text, text, text, timestamptz, integer) to persi_app, persi_worker;

comment on table public.oauth_integration_tokens is
  'Encrypted-at-rest OAuth token storage for Olist v3 apps. Ciphertext only -- Postgres never holds a plaintext token. See docs/native-commerce/olist-oauth-flow-design.md.';
