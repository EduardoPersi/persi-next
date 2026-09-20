-- ACCELERATED ROUND — Track A: PENDING RESERVATION EXPIRATION / RECOVERY.
--
-- Closes the gap documented in docs/database/78 Section 12 and docs/database/79
-- Section 12: inventory_reservations.expires_at (20260823110400_inventory.sql)
-- and its purpose-built partial index, inventory_reservations_active_expiry_idx
-- (expires_at, id) where status = 'active', have existed since the checkout
-- foundation round, but nothing has ever read them proactively. A reservation
-- whose payment preparation never reaches a terminal state (customer abandons
-- after order creation, before any payment attempt exists or before a webhook/
-- reconciliation probe ever arrives) stays 'active' forever, holding stock.
--
-- This migration adds ONE new SECURITY DEFINER entrypoint,
-- reclaim_expired_native_reservations, following the exact same ownership
-- idiom as apply_verified_payment_transition
-- (20260921000000_shared_payment_order_inventory_orchestration.sql): it is
-- SECURITY DEFINER (owned by postgres) so its internal call to the SECURITY
-- INVOKER release_inventory_reservation (20260823110400_inventory.sql) runs
-- as the function owner without widening any grant on that primitive itself,
-- and without ever exposing release authority to persi_app or the browser.
-- It does not modify release_inventory_reservation,
-- confirm_inventory_reservation, apply_verified_payment_transition, or any
-- table/grant defined by any historical or frozen migration.
--
-- Convergence with apply_verified_payment_transition (the PAID-vs-expired
-- race, spec properties A4/A5): both functions reach a candidate reservation
-- only via `select ... for update` (this function) or `for update` inside a
-- loop (the orchestrator's confirm/release loop). Postgres row locks make the
-- two mutually exclusive — whichever transaction locks the row first proceeds
-- to completion; the other, arriving after, either finds the row already
-- non-'active' (this function's WHERE clause; the orchestrator's confirm/
-- release loop WHERE clause) and simply does not touch it, or is blocked
-- briefly by the lock and then observes the post-transition state once
-- unblocked. There is no code path where both a confirm and a release apply
-- to the same reservation. If a payment is verified as 'paid' strictly AFTER
-- this function has already released the reservation for the same order (the
-- worker ran, then a late webhook/reconciliation probe arrives), the order
-- still transitions to 'confirmed' (apply_verified_payment_transition's
-- confirm loop simply confirms zero reservations, since none remain
-- 'active') — a paid order with an already-released reservation is a
-- documented operational risk inherent to any expiration-based reclaim
-- design, mitigated by operators setting inventory_reservations.expires_at
-- with adequate margin beyond each payment method's own provider-side
-- expiry window (Pix QR validity, boleto due date, card/wallet authorization
-- window) — not something this function's logic can or should resolve, in
-- keeping with this project's rule against inventing order-domain behavior
-- (orders.status has no state for "paid after stock already released", and
-- none is added here).
--
-- Batching: SKIP LOCKED lets concurrent callers (multiple worker invocations,
-- or a worker invocation racing an in-flight apply_verified_payment_transition
-- call for the same order) each make forward progress on disjoint rows
-- instead of blocking on one another, satisfying A10 (zero deadlocks) by
-- construction — no code path in this function ever waits on a lock it does
-- not already hold.
create function public.reclaim_expired_native_reservations(
  p_batch_size integer default 100,
  p_actor text default 'reservation_expiration_worker'
)
returns table (
  reservation_id uuid,
  reservation_status public.inventory_reservation_status,
  released boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_after public.inventory_reservations;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 1000 then
    raise exception using errcode = '22023', message = 'invalid_batch_size';
  end if;

  for r in
    select res.id
    from public.inventory_reservations res
    where res.status = 'active' and res.expires_at <= now()
    order by res.expires_at, res.id
    limit p_batch_size
    for update skip locked
  loop
    select * into v_after from public.release_inventory_reservation(
      r.id, concat('expiration:', r.id), p_actor
    );
    reservation_id := v_after.id;
    reservation_status := v_after.status;
    released := (v_after.status = 'released');
    return next;
  end loop;
end;
$$;

-- Security (same idiom as apply_verified_payment_transition, Section 8/23):
-- revoke all from public/anon/authenticated/persi_app, grant EXECUTE only to
-- persi_worker. This is a backend/scheduler authority exactly like
-- apply_verified_payment_transition — persi_app (browser-facing) can never
-- reclaim stock on its own initiative, only a trusted worker can.
alter function public.reclaim_expired_native_reservations(
  integer, text
) owner to postgres;

revoke all on function public.reclaim_expired_native_reservations(
  integer, text
) from public, anon, authenticated, persi_app;

grant execute on function public.reclaim_expired_native_reservations(
  integer, text
) to persi_worker;

comment on function public.reclaim_expired_native_reservations(
  integer, text
) is 'ACCELERATED-A pending reservation expiration/recovery: bounded, SKIP LOCKED batch reclaim of inventory_reservations past their own expires_at, reusing release_inventory_reservation unchanged. persi_worker only. Not called by any scheduler yet (no cron wired this round) -- callable ahead of one being authorized.';
