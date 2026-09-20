# 80 — Native Reservation Expiration / Recovery (ACCELERATED — Track A)

Status: **qualified, not live**. Nothing in this round wires a scheduler, a
route, or any caller into the running application. This document,
[`supabase/migrations/20260922000000_native_reservation_expiration_recovery.sql`](../../supabase/migrations/20260922000000_native_reservation_expiration_recovery.sql),
[`supabase/tests/database/native_reservation_expiration_recovery.test.sql`](../../supabase/tests/database/native_reservation_expiration_recovery.test.sql),
[`lib/db/nativePayment.ts`](../../lib/db/nativePayment.ts) (the
`reclaimExpiredNativeReservations` addition),
[`lib/commerce/reservationExpirationWorker.ts`](../../lib/commerce/reservationExpirationWorker.ts),
and [`scripts/database/native-reservation-expiration-recovery-concurrency.mjs`](../../scripts/database/native-reservation-expiration-recovery-concurrency.mjs)
are new; every historical/frozen migration and file is untouched.

## 1. Why this exists

[78-shared-payment-order-inventory-orchestration.md](78-shared-payment-order-inventory-orchestration.md)
Section 12 and [79-native-checkout-payment-wiring.md](79-native-checkout-payment-wiring.md)
Section 12 both documented the same gap without resolving it:
`inventory_reservations.expires_at` (and its purpose-built partial index,
`inventory_reservations_active_expiry_idx`) has existed since
`20260823110400_inventory.sql`, but nothing ever reads it proactively. A
reservation whose payment preparation never reaches a terminal state — a
customer abandons after order creation but before any payment attempt exists,
or before a webhook/reconciliation probe ever arrives — stays `'active'`
forever, holding stock no other customer can buy. `PENDING_RESERVATION_
RECOVERY_READY` was `NO`, classified `BLOCKING_FOR_STAGING`. This round makes
it `YES`.

## 2. The privilege boundary this had to route around

`release_inventory_reservation` (`20260823110400_inventory.sql`) is `SECURITY
INVOKER`, and — same as `confirm_inventory_reservation` before B.3-H — has
never been granted `EXECUTE` to `persi_app` or `persi_worker`. Its only
existing caller before this round was `close_native_checkout` (checkout
abandonment, itself `SECURITY DEFINER`). A worker calling it directly would
need a new grant on the primitive itself, which would also hand release
authority to anything else already holding that grant — exactly the widening
this project's security idiom avoids.

This migration adds **one** new `SECURITY DEFINER` entrypoint,
`reclaim_expired_native_reservations(p_batch_size int, p_actor text)`,
following the identical ownership idiom `apply_verified_payment_transition`
established in B.3-H: owned by `postgres`, so its internal call to
`release_inventory_reservation` runs as the function owner without any new
grant on that primitive, and without ever exposing release authority to
`persi_app` or the browser. `EXECUTE` is granted to `persi_worker` only,
revoked from `public`/`anon`/`authenticated`/`persi_app` — a backend/scheduler
authority, never a browser-facing one.

## 3. Design

```sql
reclaim_expired_native_reservations(p_batch_size integer default 100, p_actor text default 'reservation_expiration_worker')
returns table (reservation_id uuid, reservation_status inventory_reservation_status, released boolean)
```

- Selects `status = 'active' and expires_at <= now()`, ordered by
  `(expires_at, id)`, `limit p_batch_size`, `for update skip locked`.
- For each candidate, calls `release_inventory_reservation` unchanged — that
  function already re-checks `status <> 'active'` and returns a safe no-op if
  so (`20260823110400_inventory.sql:174-176`), so no extra idempotency
  bookkeeping was added here.
- `p_batch_size` bounded to `[1, 1000]`; out-of-range raises `22023`
  (`invalid_batch_size`) rather than silently clamping.

**Convergence with `apply_verified_payment_transition` (spec properties
A4/A5).** Both functions only ever touch a reservation via a row lock
(`for update`, here at the batch-selection level; there, inside its own
confirm/release loop). Postgres locks make the two mutually exclusive:
whichever transaction locks the row first proceeds to completion; the other —
arriving after — finds the row already non-`'active'` and simply does not
touch it (this function's `WHERE status = 'active'` clause; the orchestrator's
confirm/release loop `WHERE ... status = 'active'` clause). There is no code
path where both a confirm and a release apply to the same reservation.

If a payment is verified `'paid'` **after** this function already released
the reservation for the same order (worker ran, then a late webhook/
reconciliation probe arrives), the order still transitions to `'confirmed'`
(`apply_verified_payment_transition`'s confirm loop simply confirms zero
reservations, since none remain `'active'`) — proven in
`native_reservation_expiration_recovery.test.sql`'s A5 block and
`native-reservation-expiration-recovery-concurrency.mjs`'s
`a5_expirationThenLatePaidConverges`. A paid order with an already-released
reservation is a **documented operational risk inherent to any
expiration-based reclaim design**, not a bug this function's logic resolves —
`orders.status` has no state for "paid after stock already released", and
none is invented here (same posture as the existing, separately documented
"refunded" order-status gap). It is mitigated operationally by setting
`inventory_reservations.expires_at` with adequate margin beyond each payment
method's own provider-side expiry window (Pix QR validity, boleto due date,
card/wallet authorization window) — an operational tuning concern for
whoever creates reservations, out of scope for this migration.

**Batching / `SKIP LOCKED`.** Lets concurrent callers (overlapping worker
invocations, or a worker racing an in-flight
`apply_verified_payment_transition` call for the same reservation) each make
forward progress on disjoint rows instead of blocking on one another — no
code path in this function ever waits on a lock it does not already hold, so
it cannot deadlock against itself or against the orchestrator.

## 4. Properties proven

pgTAP (`native_reservation_expiration_recovery.test.sql`, single-connection,
correctness-focused): security grants; A1 (single expired reservation
released once, quantities correct); A2 (idempotent replay, exactly one
release movement); A4/A9 (a `'confirmed'` or already-`'cancelled'`
reservation past `expires_at` is never a candidate); A5 (late verified payment
after expiration-release converges: order confirms, `inventory_confirmed_
count = 0`, reservation stays `'released'`); A8 (non-expired untouched);
batch-size validation.

Node/real-Postgres concurrency script (`native-reservation-expiration-
recovery-concurrency.mjs`, ≥50 cycles for every contention property):

| Property | Result |
|---|---|
| A1 single expired reservation released once | PASS |
| A2 same job ×50 → one logical release | PASS |
| A3 50 concurrent workers racing one reservation → one logical release, zero errors | PASS |
| A4/A9 PAID vs expiration race → exactly one wins, state never mixed | PASS |
| A5 expiration-then-late-PAID convergence | PASS |
| A6/A7 cross-order / cross-reservation isolation | PASS |
| A8 non-expired untouched | PASS |
| A10 50-reservation high-contention batch → zero deadlocks | PASS |
| Batch-size validation (0, 1001 rejected) | PASS |

All properties `true`; `ALL_PASS: true`.

## 5. `processExpiredNativeReservations` (the future-cron shape)

`lib/commerce/reservationExpirationWorker.ts` wraps
`reclaimExpiredNativeReservations` in a bounded-batch loop, mirroring
`services/payments/cronReconciliation.ts`'s `reconcilePendingOrders` shape: a
time budget (`DEFAULT_TIME_BUDGET_MS = 20_000`) checked before each batch,
never starting new work once the budget is spent, returning
`{ batches, reclaimed, released, truncated, durationMs }`. **No scheduler or
HTTP route calls this in this round** — it exists so Track H's staging
package can name a stable, already-tested primitive for a future cron to
drive (see Section 6), without inventing this shape at that time.

## 6. What this round does NOT do

- No cron route (no `app/api/cron/expire-native-reservations`-style
  endpoint). Wiring one is a Track H staging task (needs a `CRON_SECRET`-style
  auth decision, an overlap guard instance, and an external scheduler —
  cron-job.org / Hostinger cron, matching the existing `expire-pending-
  payments` cron's own operational model).
- No change to how `inventory_reservations.expires_at` is *set* at
  reservation-creation time — that TTL is out of scope here; picking the
  right margin above each payment method's provider-side expiry window is an
  operational decision for whoever tunes checkout, not this migration.
- No change to `release_inventory_reservation`, `confirm_inventory_
  reservation`, `apply_verified_payment_transition`, or any historical/frozen
  migration.
- No "refunded"-after-release reconciliation UX — same documented,
  deliberately-not-invented gap as the payment ledger's own refund/order-state
  boundary.
