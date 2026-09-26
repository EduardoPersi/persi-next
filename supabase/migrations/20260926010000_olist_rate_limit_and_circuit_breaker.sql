-- Olist Fase 1 (read-only) -- shared rate limit + circuit breaker.
--
-- Design: docs/native-commerce/olist-integration-design.md Section 14.4.
-- NOT APPLIED to any real Supabase project by this round -- listed for the
-- owner's review before `supabase db push --linked` against staging.
--
-- Why a token bucket in Postgres, not in-memory: canary-minimum-scope.md
-- Section 5.1 found staging runtime logs consistent with 2 Node processes
-- per restart. Every existing in-memory rate limiter in this app
-- (lib/network/rateLimit.ts, lib/commerce/nativeCommerceIdempotency.ts)
-- already documents that it assumes a single persistent process. Olist's
-- own limit (60 req/min per account, confirmed by their support,
-- olist-integration-design.md Section 14.4) is external and real --
-- exceeding it risks 429s against an account shared with the official
-- Olist<->Woo integration. A Postgres-backed bucket is correct regardless
-- of process count, at the cost of one round-trip per check.
--
-- Algorithm: continuous-refill token bucket, not the fixed-window shape of
-- consume_admin_rate_limit (20260912040000) -- a fixed window can allow a
-- 2x burst across a window boundary, which is fine for an admin-abuse
-- guard but not for respecting a real provider-side limit shared with
-- another integration.
create table public.olist_rate_limit_buckets (
  bucket_key text primary key check (length(btrim(bucket_key)) between 1 and 100),
  tokens_available numeric not null check (tokens_available >= 0),
  capacity numeric not null check (capacity > 0),
  refill_per_minute numeric not null check (refill_per_minute > 0),
  last_refill_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.olist_rate_limit_buckets enable row level security;
alter table public.olist_rate_limit_buckets force row level security;
alter table public.olist_rate_limit_buckets owner to postgres;

-- Consumer contract: pass the SAME (p_capacity, p_refill_per_minute) every
-- call for a given p_bucket -- they are only used to initialize a bucket
-- row the first time it's seen, and to cap refill on every call, not
-- re-read from storage. Changing them later takes effect immediately
-- (capacity shrinks/grows on the next call), which is intentional --
-- lets the site raise/lower its own reserved share (Section 14.4's ~28/min
-- baseline) via a code/env change, without a migration.
create function public.consume_olist_rate_limit(
  p_bucket text,
  p_tokens_requested numeric,
  p_capacity numeric,
  p_refill_per_minute numeric
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  granted boolean;
begin
  if p_bucket is null or length(btrim(p_bucket)) < 1 or length(btrim(p_bucket)) > 100 then
    raise exception using errcode = '22023', message = 'invalid_olist_rate_limit_bucket';
  end if;
  if p_tokens_requested is null or p_tokens_requested <= 0
     or p_capacity is null or p_capacity <= 0
     or p_refill_per_minute is null or p_refill_per_minute <= 0 then
    raise exception using errcode = '22023', message = 'invalid_olist_rate_limit_input';
  end if;

  insert into public.olist_rate_limit_buckets (bucket_key, tokens_available, capacity, refill_per_minute)
  values (p_bucket, p_capacity, p_capacity, p_refill_per_minute)
  on conflict (bucket_key) do nothing;

  with refilled as (
    update public.olist_rate_limit_buckets
    set capacity = p_capacity,
        refill_per_minute = p_refill_per_minute,
        tokens_available = least(
          p_capacity,
          tokens_available + greatest(0, extract(epoch from (clock_timestamp() - last_refill_at)) / 60.0) * p_refill_per_minute
        ),
        last_refill_at = clock_timestamp()
    where bucket_key = p_bucket
    returning tokens_available
  ),
  spent as (
    update public.olist_rate_limit_buckets
    set tokens_available = tokens_available - p_tokens_requested,
        updated_at = clock_timestamp()
    where bucket_key = p_bucket
      and (select tokens_available from refilled) >= p_tokens_requested
    returning true as ok
  )
  select coalesce((select ok from spent), false) into granted;

  return granted;
end;
$$;

alter function public.consume_olist_rate_limit(text, numeric, numeric, numeric) owner to postgres;
revoke all on function public.consume_olist_rate_limit(text, numeric, numeric, numeric) from public, anon, authenticated;
-- Both roles: the cart/checkout live stock check (Section 5.7) runs as
-- persi_app (inside prepare_native_checkout's caller, per the owner's
-- condition that the HTTP call itself never happens inside a Postgres
-- transaction/lock -- this function is only ever called standalone,
-- immediately before or after the HTTP call, never wrapping it); webhook
-- re-query, reconciliation and order export run as persi_worker.
grant execute on function public.consume_olist_rate_limit(text, numeric, numeric, numeric) to persi_app, persi_worker;

comment on function public.consume_olist_rate_limit(text, numeric, numeric, numeric) is
  'Continuous-refill token bucket shared across every Node process. Never call while holding a Postgres transaction/lock spanning an HTTP request to Olist.';

-- ---------------------------------------------------------------------------
-- Circuit breaker: after repeated Olist failures, stop attempting for a
-- cooldown window. State lives here (not in memory) for the same
-- multi-process reason as the bucket above -- every process must agree the
-- circuit is open, not just the one that observed the failures.
-- ---------------------------------------------------------------------------
create table public.olist_circuit_breaker_state (
  breaker_key text primary key check (length(btrim(breaker_key)) between 1 and 100),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  opened_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.olist_circuit_breaker_state enable row level security;
alter table public.olist_circuit_breaker_state force row level security;
alter table public.olist_circuit_breaker_state owner to postgres;

create function public.record_olist_api_result(
  p_breaker text,
  p_succeeded boolean,
  p_failure_threshold integer,
  p_cooldown_seconds integer
)
returns table (is_open boolean, opened_until timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_breaker is null or length(btrim(p_breaker)) < 1 then
    raise exception using errcode = '22023', message = 'invalid_olist_circuit_breaker_key';
  end if;
  if p_failure_threshold is null or p_failure_threshold < 1
     or p_cooldown_seconds is null or p_cooldown_seconds < 1 then
    raise exception using errcode = '22023', message = 'invalid_olist_circuit_breaker_input';
  end if;

  insert into public.olist_circuit_breaker_state (breaker_key)
  values (p_breaker)
  on conflict (breaker_key) do nothing;

  if p_succeeded then
    update public.olist_circuit_breaker_state
    set consecutive_failures = 0, opened_until = null, updated_at = clock_timestamp()
    where breaker_key = p_breaker;
  else
    update public.olist_circuit_breaker_state
    set consecutive_failures = consecutive_failures + 1,
        opened_until = case
          when consecutive_failures + 1 >= p_failure_threshold
            then clock_timestamp() + make_interval(secs => p_cooldown_seconds)
          else opened_until
        end,
        updated_at = clock_timestamp()
    where breaker_key = p_breaker;
  end if;

  return query
    select
      (s.opened_until is not null and s.opened_until > clock_timestamp()),
      s.opened_until
    from public.olist_circuit_breaker_state s
    where s.breaker_key = p_breaker;
end;
$$;

alter function public.record_olist_api_result(text, boolean, integer, integer) owner to postgres;
revoke all on function public.record_olist_api_result(text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.record_olist_api_result(text, boolean, integer, integer) to persi_app, persi_worker;

-- Cheap pre-check (no write) so a caller can skip even attempting the HTTP
-- call -- and skip consuming a rate-limit token for a call it already
-- knows will be refused by the breaker.
create function public.is_olist_circuit_open(p_breaker text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (select s.opened_until is not null and s.opened_until > clock_timestamp()
     from public.olist_circuit_breaker_state s
     where s.breaker_key = p_breaker),
    false
  );
$$;

alter function public.is_olist_circuit_open(text) owner to postgres;
revoke all on function public.is_olist_circuit_open(text) from public, anon, authenticated;
grant execute on function public.is_olist_circuit_open(text) to persi_app, persi_worker;
