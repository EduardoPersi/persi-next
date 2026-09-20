-- B.3-H — SHARED PAYMENT -> ORDER -> INVENTORY ORCHESTRATION.
--
-- Resolves, ONCE, for every provider (Inter, Mercado Pago, PagBank), the
-- boundary every native gateway adapter round (B.3-E/F/G) found and
-- deliberately left unresolved: confirm_inventory_reservation and
-- release_inventory_reservation (20260823110400_inventory.sql) are
-- SECURITY INVOKER and have never been granted EXECUTE to persi_app or
-- persi_worker. The only existing caller of release_inventory_reservation
-- is close_native_checkout (checkout abandonment); confirm_inventory_
-- reservation has NO existing caller at all. Neither can safely be called
-- directly by a payment-confirmation flow today.
--
-- This migration adds ONE new SECURITY DEFINER entrypoint,
-- apply_verified_payment_transition, following the exact same ownership
-- idiom already used by submit_native_checkout and close_native_checkout:
-- it is SECURITY DEFINER (owned by postgres), so its internal calls to the
-- SECURITY INVOKER inventory primitives run as the function owner without
-- needing any new grant on those primitives themselves, and without ever
-- widening browser-facing privileges. It does not modify
-- confirm_inventory_reservation, release_inventory_reservation,
-- transition_native_payment_attempt, record_native_payment_event,
-- transition_native_order, or any table/grant defined by 20260920000000_
-- native_payment_ledger_foundation.sql (frozen) or any historical
-- migration.

-- ---------------------------------------------------------------------------
-- apply_verified_payment_transition(attempt, event) -> {payment, order,
-- inventory} applied atomically, in one transaction.
--
-- Design (see docs/database/78 for the full rationale):
--
--  * Takes ONLY a payment_attempt_id plus event-observation parameters
--    (the exact same shape record_native_payment_event already accepts).
--    provider is DERIVED from the attempt row, never caller-supplied --
--    a caller cannot claim an attempt belongs to a different provider than
--    it actually does, and the function signature carries no order_id or
--    inventory_reservation_id parameter at all: which order and which
--    reservations are affected is derived exclusively from
--    payment_attempts.order_id and order_items.order_id, never chosen by
--    the caller (Section 9 / CROSS_ORDER_MUTATION_BLOCKED).
--
--  * LOCK_ORDER (fixed, and the ONLY function in the system that acquires
--    more than one of these locks together, so it cannot deadlock against
--    itself or anything else): payment_attempts (by id) -> orders (by the
--    attempt's order_id) -> inventory_reservations (by id, joined through
--    order_items) -> inventory_levels (acquired internally by confirm_/
--    release_inventory_reservation, one row at a time, exactly as those
--    functions already do on their own).
--
--  * Reuses record_native_payment_event for the payment-ledger step
--    (Section 14: "não duplicar responsabilidade do payment_events") --
--    this function does not reimplement event dedupe or the payment state
--    machine's transition validity rules; it calls the existing, already-
--    proven function and inspects its result.
--
--  * Idempotency: the "did this call actually just move the attempt to
--    paid / to a terminal failure" determination is made by comparing the
--    attempt's version and status BEFORE (captured under this function's
--    own lock, before delegating to record_native_payment_event) against
--    AFTER. A replay (duplicate webhook, stale reconciliation probe, a
--    concurrent caller that lost the row-lock race) always observes
--    version unchanged or a status already at its target, and the order/
--    inventory block is skipped entirely -- not merely made a safe no-op,
--    genuinely never entered.
--
--  * Atomicity (Section 10, the property this whole migration exists for):
--    inside the genuine-transition branch, transition_native_order and
--    confirm_/release_inventory_reservation are called UNCONDITIONALLY,
--    with no defensive "skip if not in the expected state" guard. If the
--    order is not 'pending' when a paid/terminal transition is warranted
--    (an anomaly -- e.g. something else already cancelled the order while
--    payment was in flight), transition_native_order raises, and that
--    exception unwinds the ENTIRE function call, rolling back the payment
--    attempt's own transition (performed earlier in this same call via
--    record_native_payment_event) along with it. The forbidden end states
--    Section 10 names -- "paid + order stale", "paid + inventory
--    released", "failed + inventory confirmed" -- are prevented by this
--    being one atomic PL/pgSQL call, not by any additional bookkeeping.
--
--  * AUTHORIZED is deliberately NOT treated as a trigger for inventory
--    confirmation (Section 17) -- only a genuine transition to the ledger's
--    'paid' status confirms stock; an authorization-only state changes
--    nothing about order/inventory.
--
--  * refunded/partially_refunded are deliberately NOT handled here at all
--    (Section 7): orders.status has no "refunded" state, and inventing
--    order/inventory behavior for a refund without explicit order-domain
--    support is exactly the kind of improvisation this round is told not
--    to do. A resulting_status of refunded/partially_refunded still
--    updates the payment ledger (via record_native_payment_event, reusing
--    its own existing, already-valid transitions from 'paid') but leaves
--    order and inventory untouched -- documented as a POST_V1 gap, not a
--    silent bug.
create function public.apply_verified_payment_transition(
  p_attempt_id uuid,
  p_event_type public.payment_event_type,
  p_external_event_id text default null,
  p_observed_status text default null,
  p_resulting_status public.payment_attempt_status default null,
  p_payload_digest text default null
)
returns table (
  payment_attempt_id uuid,
  payment_status public.payment_attempt_status,
  payment_version bigint,
  payment_event_id uuid,
  payment_event_processing_result public.payment_event_processing_result,
  order_id uuid,
  order_status public.order_status,
  order_transitioned boolean,
  inventory_confirmed_count integer,
  inventory_released_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.payment_attempts;
  v_provider public.payment_provider;
  v_version_before bigint;
  v_status_before public.payment_attempt_status;
  v_event public.payment_events;
  v_order public.orders;
  v_order_transitioned boolean := false;
  v_confirmed_count integer := 0;
  v_released_count integer := 0;
  r record;
begin
  select * into v_attempt from public.payment_attempts where id = p_attempt_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'payment_attempt_not_found';
  end if;
  v_provider := v_attempt.provider;
  v_version_before := v_attempt.version;
  v_status_before := v_attempt.status;

  select * into v_order from public.orders where id = v_attempt.order_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;

  select * into v_event from public.record_native_payment_event(
    p_attempt_id, v_provider, p_event_type, p_external_event_id, p_observed_status, p_resulting_status, p_payload_digest
  );

  select * into v_attempt from public.payment_attempts where id = p_attempt_id;

  if v_status_before <> 'paid' and v_attempt.status = 'paid' and v_attempt.version > v_version_before then
    perform public.transition_native_order(
      v_order.id, 'pending', 'confirmed', v_order.version, 'worker', p_attempt_id::text,
      'payment_verified_paid', 'Verified payment transitioned to paid', p_attempt_id
    );
    select * into v_order from public.orders where id = v_order.id;
    v_order_transitioned := true;

    for r in
      select res.* from public.inventory_reservations res
      join public.order_items oi on oi.id = res.order_item_id
      where oi.order_id = v_order.id and res.status = 'active'
      order by res.id
      for update
    loop
      perform public.confirm_inventory_reservation(r.id, concat('payment:', p_attempt_id), 'persi_payment_orchestrator');
      v_confirmed_count := v_confirmed_count + 1;
    end loop;

  elsif v_status_before not in ('failed', 'cancelled', 'expired')
    and v_attempt.status in ('failed', 'cancelled', 'expired')
    and v_attempt.version > v_version_before then
    perform public.transition_native_order(
      v_order.id, 'pending', 'cancelled', v_order.version, 'worker', p_attempt_id::text,
      concat('payment_verified_', v_attempt.status::text), 'Verified payment reached a terminal failure', p_attempt_id
    );
    select * into v_order from public.orders where id = v_order.id;
    v_order_transitioned := true;

    for r in
      select res.* from public.inventory_reservations res
      join public.order_items oi on oi.id = res.order_item_id
      where oi.order_id = v_order.id and res.status = 'active'
      order by res.id
      for update
    loop
      perform public.release_inventory_reservation(r.id, concat('payment:', p_attempt_id), 'persi_payment_orchestrator');
      v_released_count := v_released_count + 1;
    end loop;
  end if;

  return query select
    v_attempt.id, v_attempt.status, v_attempt.version,
    v_event.id, v_event.processing_result,
    v_order.id, v_order.status, v_order_transitioned,
    v_confirmed_count, v_released_count;
end;
$$;

-- Security (Section 8/23): same idiom as every SECURITY DEFINER entrypoint
-- in this project -- revoke all from public/anon/authenticated, grant
-- EXECUTE only to the role that legitimately drives verified-payment
-- application. This is a backend/webhook/reconciliation authority exactly
-- like transition_native_payment_attempt and record_native_payment_event
-- (20260920000000_native_payment_ledger_foundation.sql) -- persi_worker
-- ONLY, never persi_app. The browser-facing role can ask for a payment
-- attempt to exist; it can never apply a verified transition, confirm
-- stock, or move an order forward.
alter function public.apply_verified_payment_transition(
  uuid, public.payment_event_type, text, text, public.payment_attempt_status, text
) owner to postgres;

revoke all on function public.apply_verified_payment_transition(
  uuid, public.payment_event_type, text, text, public.payment_attempt_status, text
) from public, anon, authenticated, persi_app;

grant execute on function public.apply_verified_payment_transition(
  uuid, public.payment_event_type, text, text, public.payment_attempt_status, text
) to persi_worker;

comment on function public.apply_verified_payment_transition(
  uuid, public.payment_event_type, text, text, public.payment_attempt_status, text
) is 'B.3-H shared, provider-neutral, server-authoritative orchestration: verified payment status -> payment ledger transition -> native order transition -> inventory reservation confirm/release, applied atomically. persi_worker only. Not called by any route yet (native checkout runtime remains disabled).';
