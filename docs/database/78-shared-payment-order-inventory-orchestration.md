# 78 — Shared Payment → Order → Inventory Orchestration (B.3-H)

Status: **qualified, not live**. No provider call, no checkout wiring, no
new public endpoint. New files:
[`supabase/migrations/20260921000000_shared_payment_order_inventory_orchestration.sql`](../../supabase/migrations/20260921000000_shared_payment_order_inventory_orchestration.sql),
[`supabase/tests/database/shared_payment_order_inventory_orchestration.test.sql`](../../supabase/tests/database/shared_payment_order_inventory_orchestration.test.sql),
[`scripts/database/shared-payment-orchestration-concurrency.mjs`](../../scripts/database/shared-payment-orchestration-concurrency.mjs).
Modified (mechanically, to call the new shared entrypoint instead of
`record_native_payment_event` directly): `lib/db/nativePayment.ts` (new
`applyVerifiedPaymentTransition` wrapper) and all three gateway adapters
(`services/payments/{inter,mercadopago,pagbank}/nativeAdapter.ts`) — see
Section 8.

## 1. The blocker this round resolves

Every gateway round (75, 76, 77) found the identical boundary:
`confirm_inventory_reservation`/`release_inventory_reservation`
(`20260823110400_inventory.sql`) are `SECURITY INVOKER` and have never been
granted `EXECUTE` to `persi_app` or `persi_worker`. `release_inventory_
reservation`'s only existing caller is `close_native_checkout` (checkout
abandonment); `confirm_inventory_reservation` had **no** existing caller at
all. Neither primitive can be invoked directly by a payment-confirmation
flow.

## 2. Surgical audit (Section 5)

- **`CURRENT_PAYMENT_STATE_MACHINE`**: `created → {pending, cancelled}`;
  `pending → {authorized, paid, failed, cancelled, expired}`; `authorized →
  {paid, failed, cancelled}`; `paid → {refunded, partially_refunded}`;
  `partially_refunded → {refunded, partially_refunded}` (unchanged, read
  from the frozen ledger migration).
- **`CURRENT_ORDER_STATE_MACHINE`**: `pending → {confirmed, cancelled}`;
  `confirmed → {completed, cancelled}` (`enforce_native_order_status_transition`,
  `20260903010000_native_order_foundation.sql`, unchanged).
- **`CURRENT_INVENTORY_STATE_MACHINE`**: `active → {confirmed, released,
  expired, cancelled}` (`inventory_reservation_status`,
  `20260823110000_core.sql`); `confirm_inventory_reservation`/`release_
  inventory_reservation` are idempotent no-ops when a reservation is
  already non-`active`.
- **Ownership pattern already established**: `submit_native_checkout` and
  `close_native_checkout` (both `SECURITY DEFINER`, owned by `postgres`)
  call `SECURITY INVOKER` primitives internally without any extra grant,
  because a `SECURITY DEFINER` function's internal calls execute as its
  owner. This round's entrypoint follows the exact same idiom — no new
  grant on `confirm_inventory_reservation`/`release_inventory_reservation`
  themselves, ever.

## 3. `apply_verified_payment_transition` — the one shared entrypoint

```
apply_verified_payment_transition(
  p_attempt_id uuid, p_event_type payment_event_type,
  p_external_event_id text default null, p_observed_status text default null,
  p_resulting_status payment_attempt_status default null, p_payload_digest text default null
) returns table(payment_attempt_id, payment_status, payment_version,
  payment_event_id, payment_event_processing_result,
  order_id, order_status, order_transitioned,
  inventory_confirmed_count, inventory_released_count)
```

- **No `order_id` or `reservation_id` parameter** — both are derived from
  `payment_attempts.order_id` and `order_items.order_id` respectively. A
  caller cannot name a different order; `CROSS_ORDER_MUTATION_BLOCKED` is
  true by construction, not by a runtime check (proven anyway — Section 7).
- **No `provider` parameter** — derived from the attempt row, then passed
  through to `record_native_payment_event` internally. `PROVIDER_NEUTRAL_
  ORCHESTRATION = YES`: the function body contains no `if provider =
  'inter'`/`'mercado_pago'`/`'pagbank'` branch anywhere.
- Reuses `record_native_payment_event` for the ledger step — the payment
  state machine's transition validity and event dedupe are not
  reimplemented (Section 14).

## 4. `LOCK_ORDER`

`payment_attempts` (by id, `for update`) → `orders` (by the attempt's own
`order_id`, `for update`) → `inventory_reservations` (by id, ordered,
joined through `order_items`, `for update`) → `inventory_levels` (acquired
internally, one row at a time, by `confirm_/release_inventory_reservation`
themselves, unchanged).

This is the **only** function in the schema that acquires more than one of
these locks together, so it cannot deadlock against itself or against any
other existing function — none of them contend for this same combination.
Proven at 50-way real concurrency with zero deadlocks (harness property
`zeroDeadlocks`).

## 5. Atomicity (Section 10) — the core property

Genuine-transition branches (paid, or a terminal failure) call
`transition_native_order` **unconditionally** — no defensive
"skip-if-not-pending" guard. If the order is not `pending` when a
transition is warranted (e.g. an out-of-band admin cancellation raced with
payment confirmation), `transition_native_order` raises
`stale_order_transition`, and that exception unwinds the **entire** function
call — including the payment attempt's own transition to `paid`, performed
moments earlier in the same call via `record_native_payment_event`. The
forbidden end states from Section 10 — "paid + order stale", "paid +
inventory released", "failed + inventory confirmed" — are prevented by this
being one atomic PL/pgSQL call, not by extra bookkeeping. Proven directly
(pgTAP `throws_ok` + harness property `orderFailureForcesFullRollback`):
after the forced failure, the payment attempt's status and version are
back to their pre-call values.

**Property E (an artificial inventory-step failure) is marked
`NOT_APPLICABLE_STRUCTURALLY_UNREACHABLE`, not skipped or faked.**
`confirm_inventory_reservation`'s own invariant check
(`quantity_on_hand`/`quantity_reserved >= reservation.quantity`) cannot
fail under any operation the schema itself allows: the table-wide check
constraint `inventory_levels_reservation_check` (`quantity_reserved <=
quantity_on_hand`) and `adjust_inventory`'s own refusal to drop `on_hand`
below the current `quantity_reserved` together make that specific invariant
unreachable by construction. This is a **positive** finding about the
schema's existing defenses, verified by reasoning through every function
that can touch `inventory_levels`, not an untested gap.

## 6. Idempotency (Section 12)

The "did this call genuinely just transition the attempt" determination
compares `payment_attempts.version`/`status` captured under this function's
own lock, **before** delegating to `record_native_payment_event`, against
the same fields **after**. A replay (duplicate webhook, stale
reconciliation probe, a concurrent caller that lost the row-lock race)
always observes `version` unchanged or the target status already reached,
and the order/inventory block is **never entered** — not merely made a
safe no-op. Proven: `PAID` repeated (pgTAP), `FAILED` repeated (pgTAP), 50
concurrent identical `PAID` calls (harness property
`fiftyConcurrentPaidOneLogicalConfirmation`), 50 concurrent identical
`FAILED` calls (`fiftyConcurrentFailedOneLogicalRelease`) — each converges
on exactly one order transition and exactly one inventory effect.

## 7. Cross-order isolation (Section 9/23)

Proven both structurally (no order/reservation id ever accepted as input)
and empirically: two independent orders sharing the same inventory level,
one attempt confirmed to `paid`, the other order/attempt/reservation
verified completely untouched (pgTAP fixture + harness property
`crossAttemptIsolation`).

## 8. Adapter integration (Section 21)

All three gateway adapters' "apply a verified status" call sites — the
creation-time initial-status application, `applyNative*WebhookNotification`,
and `reconcileNative*PendingAttempt` — now call the new
`applyVerifiedPaymentTransition` (`lib/db/nativePayment.ts`) instead of
`recordNativePaymentEvent` directly. This was **necessary**, not
"unexpected" (Section 21's HARD STOP is reserved for surprises, not the
planned integration step): without it, a synchronously-declined card or an
instantly-void Pix charge would transition the payment ledger to a terminal
state but never release the reservation or cancel the order — exactly the
gap this whole round exists to close. No provider behavior, retry policy,
or status normalization changed in any of the three adapters — only the
destination of the final "apply this verified status" call. All 45 existing
adapter unit tests were updated to mock the new dependency shape and still
pass; `INTER_NATIVE_REGRESSION_PASS = YES`, `MERCADO_PAGO_NATIVE_
REGRESSION_PASS = YES`, `PAGBANK` adapter tests likewise all pass.

## 9. AUTHORIZED vs paid (Section 17)

Only a genuine transition to the ledger's `paid` status triggers inventory
confirmation. `authorized` (Mercado Pago's pre-capture state) changes
nothing about order/inventory — proven directly (pgTAP: order stays
`pending`, reservation stays `active` after an `authorized`-only
transition).

## 10. Refunded/partially_refunded (Section 7) — deliberately not touched

A `resulting_status` of `refunded`/`partially_refunded` still updates the
payment ledger (via `record_native_payment_event`, reusing its own already-
valid `paid → refunded` transitions) but leaves order and inventory
**completely untouched** — `orders.status` has no "refunded" value, and
inventing behavior for it without explicit order-domain support is exactly
the improvisation Section 7 forbids. Proven directly (pgTAP): after a
refunded transition, the order's status is unchanged.

## 11. Security (Section 8/23)

`apply_verified_payment_transition` is granted `EXECUTE` to `persi_worker`
**only** — `PUBLIC`, `anon`, `authenticated`, and `persi_app` are all
explicitly blocked (proven, pgTAP). This matches the existing boundary
established by `transition_native_payment_attempt`/`record_native_payment_
event` (Phase 2): the browser-facing role can initiate a payment attempt,
never confirm one or move stock/orders. No RLS policy changed, no table
grant widened; verified unchanged (pgTAP re-asserts `anon`/`persi_app`
privileges on `payment_attempts` are exactly as Phase 2 left them).

## 12. Pending reservation lifetime (Section 18)

Unchanged this round — no expiration worker created. The orchestrator only
ever acts on a **verified terminal** payment outcome; a reservation
expiring on its own clock (`inventory_reservations.expires_at`) is a
separate, pre-existing concern this function does not touch. Documented as
a `POST_V1_OPERATIONAL_GAP`, not resolved here.

## 13. Concurrency harness (Section 19)

`scripts/database/shared-payment-orchestration-concurrency.mjs`, real local
Postgres, no provider called:

| Property | Result |
|---|---|
| A: 50 concurrent `PAID` → one confirmation | PASS |
| B: `PAID` vs `FAILED` concurrent → deterministic, consistent | PASS |
| C: `PAID` vs `EXPIRED` concurrent → deterministic, consistent | PASS |
| D: `FAILED` replay ×50 → one release | PASS |
| E: payment + inventory failure → rollback | `NOT_APPLICABLE_STRUCTURALLY_UNREACHABLE` (Section 5) |
| F: payment + order failure → full rollback | PASS |
| G: attempt A cannot affect order/reservation B | PASS |
| H: stale event never regresses `paid` | PASS |
| I: zero deadlocks under 50-way contention | PASS |

## 14. Regression

pgTAP 709/709 (666 unchanged + 43 new). All five concurrency harnesses
(Phase 2 ledger, Inter, Mercado Pago, PagBank, this round's shared
orchestrator) re-run clean. Full `npm test` 1397/1398 (the one pre-existing,
unrelated `tests/instagramFeed.test.mjs` failure, predating every round in
this whole engagement). `npx tsc --noEmit` clean.
`PERSI_OFFLINE_VALIDATION=1 npm run build:offline`: `actualExternalRequests
= 0`.

**Process note, not a defect**: an ad-hoc, disposable verification script
used to smoke-test the new function during development inserted fixture
rows directly into the persistent local database outside a rolled-back
transaction, which briefly confused two unrelated pgTAP files' own
un-scoped `count(*)` assertions on a subsequent full-suite run. Resolved by
a fresh `supabase db reset --local` before the regression run recorded
above; the script itself was deleted, nothing it created persists.
Separately, two hardcoded `provider_reference` literals left over in the
Inter round's own concurrency harness (`REQ-D`, `TXID-E`) were found to
collide with themselves on a second run against the persistent database and
were fixed to use per-run random suffixes — a harness-fixture issue, not an
adapter or ledger defect.

## 15. What this round does NOT do

- No checkout-flow wiring — nothing calls `apply_verified_payment_transition`
  from any route.
- No new public endpoint, no runtime feature flag.
- No pending-reservation expiration worker.
- No resolution of the "refunded" order-status gap, the chargeback/dispute
  gap (Sections 76/77), or partial refunds — explicitly listed as
  `POST_V1_OPERATIONAL_GAP`, not blocking for checkout wiring itself.
- No change to `20260920000000_native_payment_ledger_foundation.sql` or any
  historical migration.
