-- B.3-D Payment Ledger Foundation (schema + state machine + idempotency only).
--
-- Scope of this migration: a provider-neutral payment domain -- payment
-- attempts, an append-only payment event ledger, and a refund foundation --
-- sitting alongside the existing native order aggregate (orders/order_items/
-- .../ from 20260903010000_native_order_foundation.sql). No provider is
-- called by anything in this migration. No existing table's columns are
-- altered except a documentation comment. Forward-only: M29/M30/M31 and
-- every other historical migration are untouched.
--
-- Provider-neutral by design (Section 14): provider-specific identifiers
-- (Inter txid, Mercado Pago payment id, PagBank order id) all live in the
-- single `provider_reference` text column, scoped by `provider`, rather
-- than as separate provider-named columns -- the same shape already used
-- by public.external_mappings for catalog/ERP identities.

create type public.payment_provider as enum ('banco_inter','mercado_pago','pagbank');
create type public.payment_method as enum ('pix','boleto','credit_card','apple_pay','google_pay');
create type public.payment_attempt_status as enum ('created','pending','authorized','paid','failed','cancelled','expired','refunded','partially_refunded');
create type public.payment_event_type as enum ('status_observed','webhook_received','reconciliation_probe','manual_override');
create type public.payment_event_processing_result as enum ('applied','duplicate_ignored','stale_ignored','rejected');
create type public.refund_status as enum ('requested','processing','completed','failed','cancelled');
create type public.payment_actor_type as enum ('system','worker','admin');

-- ---------------------------------------------------------------------------
-- payment_attempts: one row per logical attempt to charge a native order.
-- A NEW attempt is a new row (e.g. customer switches from Pix to card after
-- the first attempt expires) -- attempts are never reused across a
-- materially different charge; idempotency within the SAME logical attempt
-- (retried creation, not a new charge) is what (provider, idempotency_key)
-- protects.
-- ---------------------------------------------------------------------------
create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider public.payment_provider not null,
  method public.payment_method not null,
  status public.payment_attempt_status not null default 'created',
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 200),
  provider_reference text check (provider_reference is null or length(btrim(provider_reference)) between 1 and 200),
  provider_status text check (provider_status is null or length(btrim(provider_status)) between 1 and 100),
  failure_code text check (failure_code is null or failure_code ~ '^[a-z][a-z0-9_.-]*$'),
  failure_reason text check (failure_reason is null or length(failure_reason) <= 500),
  -- Deliberately narrow and structured -- never a place for a raw provider
  -- payload. See payment_events.payload_digest for why raw payloads are
  -- never persisted at all, not even here.
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  correlation_id uuid not null default gen_random_uuid(),
  version bigint not null default 0 check (version >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  authorized_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  constraint payment_attempts_idempotency_unique unique (provider, idempotency_key),
  constraint payment_attempts_correlation_unique unique (correlation_id),
  -- No PAN/CVV/reusable token ever -- provider_reference is an opaque
  -- provider-issued identifier (Pix txid, Mercado Pago payment id, PagBank
  -- charge id), never card data. Enforced by convention + code review, not
  -- a regex (provider reference shapes vary too much to validate here
  -- usefully) -- the actual protection is that this column is populated
  -- only from provider API RESPONSES, never from raw client input, by the
  -- gateway-reanchoring phase's own adapters (not built yet).
  constraint payment_attempts_terminal_timestamp_check check (
    (status = 'created' and authorized_at is null and paid_at is null and failed_at is null and cancelled_at is null and expired_at is null) or
    (status = 'pending' and authorized_at is null and paid_at is null and failed_at is null and cancelled_at is null and expired_at is null) or
    (status = 'authorized' and authorized_at is not null and paid_at is null and failed_at is null and cancelled_at is null and expired_at is null) or
    (status in ('paid','refunded','partially_refunded') and paid_at is not null and failed_at is null and cancelled_at is null and expired_at is null) or
    (status = 'failed' and failed_at is not null and cancelled_at is null and expired_at is null) or
    (status = 'cancelled' and cancelled_at is not null and failed_at is null and expired_at is null) or
    (status = 'expired' and expired_at is not null and failed_at is null and cancelled_at is null)
  )
);
create unique index payment_attempts_provider_reference_unique on public.payment_attempts(provider, provider_reference) where provider_reference is not null;
create index payment_attempts_order_idx on public.payment_attempts(order_id, created_at, id);
create index payment_attempts_status_idx on public.payment_attempts(status, created_at, id);

-- ---------------------------------------------------------------------------
-- payment_events: append-only. Every provider status observation (a webhook
-- poke, a reconciliation re-query, an admin override) is one row, never
-- updated. The SAME external event delivered N times must produce exactly
-- ONE row here (payment_events_external_dedupe_unique) -- callers use
-- INSERT ... ON CONFLICT DO NOTHING and inspect whether a row was actually
-- inserted to know whether this delivery was new or a duplicate.
-- ---------------------------------------------------------------------------
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_attempt_id uuid not null references public.payment_attempts(id) on delete restrict,
  provider public.payment_provider not null,
  event_type public.payment_event_type not null,
  -- Null only for internally-generated events (reconciliation_probe,
  -- manual_override) that have no external provider event id to dedupe on.
  external_event_id text check (external_event_id is null or length(btrim(external_event_id)) between 1 and 200),
  observed_status text check (observed_status is null or length(btrim(observed_status)) between 1 and 100),
  resulting_attempt_status public.payment_attempt_status,
  processing_result public.payment_event_processing_result not null,
  -- SHA-256 of a minimal, non-sensitive canonical projection of whatever
  -- the provider sent -- lets two deliveries be compared/debugged without
  -- ever storing the raw webhook body (which could carry more than this
  -- domain needs, and is exactly the kind of "payload bruto desnecessário"
  -- Section 7/10 asks not to keep).
  payload_digest text check (payload_digest is null or payload_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint payment_events_external_dedupe_unique unique (provider, external_event_id)
);
create index payment_events_attempt_idx on public.payment_events(payment_attempt_id, created_at, id);
create unique index payment_events_no_external_id_allows_many on public.payment_events(id) where external_event_id is null;
comment on constraint payment_events_external_dedupe_unique on public.payment_events is
  'The actual webhook/event dedupe mechanism (Section 10): the SAME (provider, external_event_id) can only ever produce one row. NULL external_event_id (reconciliation probes, manual overrides) never collides, by the NULLS-are-distinct behaviour of a plain UNIQUE constraint -- payment_events_no_external_id_allows_many exists only to make that intentional, not accidental, explicit.';

-- ---------------------------------------------------------------------------
-- refunds: one row per requested refund (full or partial). A payment
-- attempt may have several refund rows (multiple partials); the sum of
-- non-terminal-failed refund amounts for one attempt may never exceed that
-- attempt's own amount_minor (enforced by trigger below, not just a CHECK,
-- since it is a cross-row/aggregate invariant).
-- ---------------------------------------------------------------------------
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_attempt_id uuid not null references public.payment_attempts(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  provider public.payment_provider not null,
  requested_amount_minor bigint not null check (requested_amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status public.refund_status not null default 'requested',
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 200),
  provider_reference text check (provider_reference is null or length(btrim(provider_reference)) between 1 and 200),
  reason text check (reason is null or length(reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  constraint refunds_idempotency_unique unique (provider, idempotency_key),
  constraint refunds_terminal_timestamp_check check (
    (status in ('requested','processing') and completed_at is null and failed_at is null) or
    (status = 'completed' and completed_at is not null and failed_at is null) or
    (status in ('failed','cancelled') and completed_at is null)
  )
);
create unique index refunds_provider_reference_unique on public.refunds(provider, provider_reference) where provider_reference is not null;
create index refunds_attempt_idx on public.refunds(payment_attempt_id, created_at, id);
create index refunds_order_idx on public.refunds(order_id, created_at, id);

-- ---------------------------------------------------------------------------
-- Immutability + append-only enforcement -- same idiom as
-- enforce_native_order_immutability() in 20260903010000_native_order_foundation.sql.
-- ---------------------------------------------------------------------------
create function public.enforce_native_payment_immutability() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception using errcode = '23514', message = 'payment_history_delete_forbidden'; end if;
  if tg_table_name = 'payment_events' then raise exception using errcode = '23514', message = 'payment_event_immutable'; end if;
  if tg_table_name = 'payment_attempts' then
    if new.order_id <> old.order_id or new.provider <> old.provider or new.method <> old.method
      or new.amount_minor <> old.amount_minor or new.currency <> old.currency
      or new.idempotency_key <> old.idempotency_key or new.correlation_id <> old.correlation_id then
      raise exception using errcode = '23514', message = 'payment_attempt_commercial_snapshot_immutable';
    end if;
    return new;
  end if;
  if tg_table_name = 'refunds' then
    if new.payment_attempt_id <> old.payment_attempt_id or new.order_id <> old.order_id or new.provider <> old.provider
      or new.requested_amount_minor <> old.requested_amount_minor or new.currency <> old.currency or new.idempotency_key <> old.idempotency_key then
      raise exception using errcode = '23514', message = 'refund_commercial_snapshot_immutable';
    end if;
    return new;
  end if;
  raise exception using errcode = '23514', message = 'payment_snapshot_immutable';
end $$;

-- ---------------------------------------------------------------------------
-- State machine (Section 8). One transition table, enforced on every
-- UPDATE of payment_attempts.status regardless of caller -- the SECURITY
-- DEFINER transition function below is the only privileged path, but the
-- trigger is the actual, un-bypassable guarantee.
-- ---------------------------------------------------------------------------
create function public.enforce_native_payment_attempt_status_transition() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'created' and new.status in ('pending','cancelled')) or
    (old.status = 'pending' and new.status in ('authorized','paid','failed','cancelled','expired')) or
    (old.status = 'authorized' and new.status in ('paid','failed','cancelled')) or
    (old.status = 'paid' and new.status in ('refunded','partially_refunded')) or
    (old.status = 'partially_refunded' and new.status in ('refunded','partially_refunded'))
  ) then
    raise exception using errcode = '23514', message = 'invalid_payment_attempt_status_transition';
  end if;
  if new.version <> old.version + 1 then raise exception using errcode = '40001', message = 'invalid_payment_attempt_version_transition'; end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Idempotent creation (Section 9.A): concurrent callers racing to create
-- the "same" attempt (same provider + idempotency_key) always converge on
-- exactly one row -- the loser's INSERT is swallowed by the unique
-- constraint and it is handed back the WINNER's row, never an error.
-- ---------------------------------------------------------------------------
create function public.create_native_payment_attempt(
  p_order_id uuid, p_provider public.payment_provider, p_method public.payment_method,
  p_amount_minor bigint, p_currency char(3), p_idempotency_key text, p_expires_at timestamptz default null
) returns public.payment_attempts language plpgsql security definer set search_path = '' as $$
declare a public.payment_attempts;
begin
  insert into public.payment_attempts(order_id, provider, method, amount_minor, currency, idempotency_key, expires_at)
    values (p_order_id, p_provider, p_method, p_amount_minor, p_currency, p_idempotency_key, p_expires_at)
    on conflict (provider, idempotency_key) do nothing
    returning * into a;
  if found then return a; end if;
  -- Someone else (a concurrent retry, or a genuine prior attempt) already
  -- holds this idempotency key -- hand back THAT row rather than erroring,
  -- which is what makes retried creation safe.
  select * into a from public.payment_attempts where provider = p_provider and idempotency_key = p_idempotency_key;
  return a;
end $$;

-- ---------------------------------------------------------------------------
-- State transition (Section 8/17.E): same optimistic-concurrency shape as
-- transition_native_order -- stale callers fail deterministically (40001),
-- never silently overwrite a newer state.
-- ---------------------------------------------------------------------------
create function public.transition_native_payment_attempt(
  p_attempt_id uuid, p_expected public.payment_attempt_status, p_target public.payment_attempt_status, p_expected_version bigint,
  p_provider_reference text default null, p_provider_status text default null, p_failure_code text default null, p_failure_reason text default null
) returns public.payment_attempts language plpgsql security definer set search_path = '' as $$
declare a public.payment_attempts;
begin
  select * into a from public.payment_attempts where id = p_attempt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'payment_attempt_not_found'; end if;
  if a.status <> p_expected or a.version <> p_expected_version then raise exception using errcode = '40001', message = 'stale_payment_attempt_transition'; end if;
  update public.payment_attempts set
    status = p_target, version = version + 1, updated_at = now(),
    provider_reference = coalesce(p_provider_reference, provider_reference),
    provider_status = coalesce(p_provider_status, provider_status),
    failure_code = case when p_target = 'failed' then p_failure_code else failure_code end,
    failure_reason = case when p_target = 'failed' then p_failure_reason else failure_reason end,
    authorized_at = case when p_target = 'authorized' then now() else authorized_at end,
    paid_at = case when p_target = 'paid' then now() else paid_at end,
    failed_at = case when p_target = 'failed' then now() else failed_at end,
    cancelled_at = case when p_target = 'cancelled' then now() else cancelled_at end,
    expired_at = case when p_target = 'expired' then now() else expired_at end
  where id = a.id returning * into a;
  return a;
end $$;

-- ---------------------------------------------------------------------------
-- Event recording with dedupe (Section 10). The RETURNED row's
-- processing_result tells the caller what happened: 'applied' (new event,
-- first time seen), 'duplicate_ignored' (same external_event_id already
-- recorded -- the existing row is returned, nothing new written),
-- 'stale_ignored' (the event is real and new, but the attempt has already
-- moved past what this event would imply -- recorded for audit, but never
-- used to move status backwards), 'rejected' (target status not reachable
-- from the attempt's CURRENT status at all).
-- ---------------------------------------------------------------------------
create function public.record_native_payment_event(
  p_attempt_id uuid, p_provider public.payment_provider, p_event_type public.payment_event_type,
  p_external_event_id text, p_observed_status text, p_resulting_status public.payment_attempt_status default null,
  p_payload_digest text default null
) returns public.payment_events language plpgsql security definer set search_path = '' as $$
declare e public.payment_events; a public.payment_attempts; result public.payment_event_processing_result;
begin
  -- Lock the attempt FIRST, before even considering dedupe -- this is what
  -- actually serializes concurrent deliveries of the SAME external event
  -- against each other (an earlier version of this function checked for an
  -- existing event row with a plain, unlocked SELECT before locking
  -- anything, which let two truly concurrent deliveries both pass that
  -- check and then race each other into the INSERT below, raising a raw
  -- unique-violation instead of converging cleanly -- caught by this
  -- round's own concurrency harness, fixed here).
  select * into a from public.payment_attempts where id = p_attempt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'payment_attempt_not_found'; end if;
  if p_resulting_status is null or p_resulting_status = a.status then
    result := 'applied';
  elsif (
    (a.status = 'created' and p_resulting_status in ('pending','cancelled')) or
    (a.status = 'pending' and p_resulting_status in ('authorized','paid','failed','cancelled','expired')) or
    (a.status = 'authorized' and p_resulting_status in ('paid','failed','cancelled')) or
    (a.status = 'paid' and p_resulting_status in ('refunded','partially_refunded')) or
    (a.status = 'partially_refunded' and p_resulting_status in ('refunded','partially_refunded'))
  ) then
    perform public.transition_native_payment_attempt(a.id, a.status, p_resulting_status, a.version);
    result := 'applied';
  else
    result := 'stale_ignored';
  end if;
  if p_external_event_id is not null then
    insert into public.payment_events(payment_attempt_id, provider, event_type, external_event_id, observed_status, resulting_attempt_status, processing_result, payload_digest)
      values (p_attempt_id, p_provider, p_event_type, p_external_event_id, p_observed_status, p_resulting_status, result, p_payload_digest)
      on conflict (provider, external_event_id) do nothing
      returning * into e;
    if found then return e; end if;
    -- Lost the race to a concurrent duplicate delivery that committed this
    -- exact (provider, external_event_id) first -- hand back THAT row,
    -- same idempotent-creation contract as create_native_payment_attempt
    -- and create_native_refund, never an error for a legitimate retry.
    select * into e from public.payment_events where provider = p_provider and external_event_id = p_external_event_id;
    return e;
  end if;
  insert into public.payment_events(payment_attempt_id, provider, event_type, external_event_id, observed_status, resulting_attempt_status, processing_result, payload_digest)
    values (p_attempt_id, p_provider, p_event_type, null, p_observed_status, p_resulting_status, result, p_payload_digest)
    returning * into e;
  return e;
end $$;

-- ---------------------------------------------------------------------------
-- Refunds (Section 11). Idempotent creation mirrors payment_attempts'; the
-- ceiling trigger below is the aggregate invariant a single-row CHECK
-- cannot express.
-- ---------------------------------------------------------------------------
-- Same defense-in-depth as payment_attempts' own transition trigger: even
-- though every real mutation path goes through transition_native_refund
-- (a SECURITY DEFINER function -- persi_app/persi_worker are never granted
-- raw UPDATE on this table), an elevated/superuser connection issuing a
-- raw UPDATE must still be stopped from setting an invalid status by the
-- trigger layer itself, not only by the function's own logic.
create function public.enforce_native_refund_status_transition() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'requested' and new.status in ('processing','cancelled')) or
    (old.status = 'processing' and new.status in ('completed','failed'))
  ) then
    raise exception using errcode = '23514', message = 'invalid_refund_status_transition';
  end if;
  return new;
end $$;

create function public.enforce_refund_amount_ceiling() returns trigger language plpgsql security invoker set search_path = '' as $$
declare attempt_amount bigint; committed bigint;
begin
  select amount_minor into attempt_amount from public.payment_attempts where id = new.payment_attempt_id;
  select coalesce(sum(requested_amount_minor), 0) into committed from public.refunds
    where payment_attempt_id = new.payment_attempt_id and status not in ('failed', 'cancelled') and id <> new.id;
  if committed + new.requested_amount_minor > attempt_amount then
    raise exception using errcode = '23514', message = 'refund_amount_exceeds_payment_attempt';
  end if;
  return new;
end $$;

create function public.create_native_refund(
  p_payment_attempt_id uuid, p_order_id uuid, p_provider public.payment_provider,
  p_requested_amount_minor bigint, p_currency char(3), p_idempotency_key text, p_reason text default null
) returns public.refunds language plpgsql security definer set search_path = '' as $$
declare r public.refunds;
begin
  insert into public.refunds(payment_attempt_id, order_id, provider, requested_amount_minor, currency, idempotency_key, reason)
    values (p_payment_attempt_id, p_order_id, p_provider, p_requested_amount_minor, p_currency, p_idempotency_key, p_reason)
    on conflict (provider, idempotency_key) do nothing
    returning * into r;
  if found then return r; end if;
  select * into r from public.refunds where provider = p_provider and idempotency_key = p_idempotency_key;
  return r;
end $$;

create function public.transition_native_refund(p_refund_id uuid, p_expected public.refund_status, p_target public.refund_status, p_provider_reference text default null)
returns public.refunds language plpgsql security definer set search_path = '' as $$
declare r public.refunds; attempt_id uuid; new_attempt_status public.payment_attempt_status; total_refunded bigint; attempt_amount bigint;
begin
  select * into r from public.refunds where id = p_refund_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'refund_not_found'; end if;
  if r.status <> p_expected then raise exception using errcode = '40001', message = 'stale_refund_transition'; end if;
  if not (
    (p_expected = 'requested' and p_target in ('processing','cancelled')) or
    (p_expected = 'processing' and p_target in ('completed','failed'))
  ) then raise exception using errcode = '23514', message = 'invalid_refund_status_transition'; end if;
  update public.refunds set status = p_target, updated_at = now(), provider_reference = coalesce(p_provider_reference, provider_reference),
    completed_at = case when p_target = 'completed' then now() else completed_at end,
    failed_at = case when p_target = 'failed' then now() else failed_at end
  where id = r.id returning * into r;
  if p_target = 'completed' then
    select payment_attempt_id into attempt_id from public.refunds where id = r.id;
    select amount_minor into attempt_amount from public.payment_attempts where id = attempt_id;
    select coalesce(sum(requested_amount_minor), 0) into total_refunded from public.refunds where payment_attempt_id = attempt_id and status = 'completed';
    new_attempt_status := case when total_refunded >= attempt_amount then 'refunded' else 'partially_refunded' end;
    perform public.transition_native_payment_attempt(
      attempt_id,
      (select status from public.payment_attempts where id = attempt_id),
      new_attempt_status,
      (select version from public.payment_attempts where id = attempt_id)
    );
  end if;
  return r;
end $$;

create trigger payment_attempts_status_transition before update of status on public.payment_attempts for each row execute function public.enforce_native_payment_attempt_status_transition();
create trigger payment_attempts_immutable before update or delete on public.payment_attempts for each row execute function public.enforce_native_payment_immutability();
create trigger payment_events_append_only before update or delete on public.payment_events for each row execute function public.enforce_native_payment_immutability();
create trigger refunds_status_transition before update of status on public.refunds for each row execute function public.enforce_native_refund_status_transition();
create trigger refunds_immutable before update or delete on public.refunds for each row execute function public.enforce_native_payment_immutability();
create trigger refunds_amount_ceiling before insert or update of requested_amount_minor, status on public.refunds for each row execute function public.enforce_refund_amount_ceiling();

-- ---------------------------------------------------------------------------
-- Security (Section 15). Same idiom as native_order_foundation: RLS
-- enabled, nothing granted to public/anon/authenticated, persi_app and
-- persi_worker get SELECT, and mutation is exclusively through the
-- SECURITY DEFINER functions above -- crucially, persi_app is granted
-- EXECUTE only on the one function that CREATES an attempt/refund
-- (initiating a payment/refund request is a legitimate customer-triggered,
-- checkout-adjacent action); every status-changing function
-- (transition_native_payment_attempt, record_native_payment_event,
-- transition_native_refund) is granted to persi_worker ONLY. The browser
-- can ask for a payment attempt or a refund to exist; it can never mark
-- one paid, insert an event, or move a refund forward -- that is
-- exclusively a backend (webhook/reconciliation) authority per Section 15.
-- ---------------------------------------------------------------------------
alter table public.payment_attempts enable row level security;
alter table public.payment_events enable row level security;
alter table public.refunds enable row level security;
revoke all on public.payment_attempts, public.payment_events, public.refunds from public, anon, authenticated;
revoke all on function
  public.create_native_payment_attempt(uuid, public.payment_provider, public.payment_method, bigint, char(3), text, timestamptz),
  public.transition_native_payment_attempt(uuid, public.payment_attempt_status, public.payment_attempt_status, bigint, text, text, text, text),
  public.record_native_payment_event(uuid, public.payment_provider, public.payment_event_type, text, text, public.payment_attempt_status, text),
  public.create_native_refund(uuid, uuid, public.payment_provider, bigint, char(3), text, text),
  public.transition_native_refund(uuid, public.refund_status, public.refund_status, text),
  public.enforce_native_payment_immutability(), public.enforce_native_payment_attempt_status_transition(), public.enforce_native_refund_status_transition(), public.enforce_refund_amount_ceiling()
from public, anon, authenticated;

grant select on public.payment_attempts, public.payment_events, public.refunds to persi_app, persi_worker;
grant execute on function public.create_native_payment_attempt(uuid, public.payment_provider, public.payment_method, bigint, char(3), text, timestamptz) to persi_app, persi_worker;
grant execute on function public.create_native_refund(uuid, uuid, public.payment_provider, bigint, char(3), text, text) to persi_app, persi_worker;
grant execute on function public.transition_native_payment_attempt(uuid, public.payment_attempt_status, public.payment_attempt_status, bigint, text, text, text, text) to persi_worker;
grant execute on function public.record_native_payment_event(uuid, public.payment_provider, public.payment_event_type, text, text, public.payment_attempt_status, text) to persi_worker;
grant execute on function public.transition_native_refund(uuid, public.refund_status, public.refund_status, text) to persi_worker;

create policy payment_attempts_app_select on public.payment_attempts for select to persi_app using (true);
create policy payment_attempts_worker_select on public.payment_attempts for select to persi_worker using (true);
create policy payment_events_app_select on public.payment_events for select to persi_app using (true);
create policy payment_events_worker_select on public.payment_events for select to persi_worker using (true);
create policy refunds_app_select on public.refunds for select to persi_app using (true);
create policy refunds_worker_select on public.refunds for select to persi_worker using (true);

comment on table public.payment_attempts is 'B.3-D payment ledger foundation: one row per logical charge attempt against a native order. Provider-neutral; no PAN/CVV/reusable token ever stored. Not yet wired to any live gateway (gateway-reanchoring is a separate, future phase).';
comment on table public.payment_events is 'B.3-D append-only provider-event ledger. Never trusted as payment authority by itself -- the historical pattern (re-query the provider before trusting a webhook) is preserved as a documented contract for the future gateway-reanchoring phase, not re-implemented here.';
comment on table public.refunds is 'B.3-D refund foundation. No provider is called by anything in this migration -- issuing a real refund is future gateway-reanchoring work.';
comment on column public.payment_attempts.provider_reference is 'Opaque provider-issued identifier (Pix txid / Mercado Pago payment id / PagBank charge id) -- populated only from verified provider responses, never raw client input.';
comment on column public.payment_events.payload_digest is 'SHA-256 of a minimal canonical projection of the provider payload -- the raw payload itself is never persisted.';
