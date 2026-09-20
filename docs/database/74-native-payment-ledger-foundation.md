# 74 — Native Payment Ledger Foundation (B.3-D)

> Status: FOUNDATION ONLY. No provider is called by anything in this phase.
> Gateway reanchoring (wiring `services/payments/{inter,mercadopago,pagbank}`
> to actually call the functions below, instead of writing to WooCommerce
> orders) is a separate, later phase. Not deployed to staging. Not committed
> to git as of this document.

## 1. Why this exists

Before this phase, the chain `native order -> ??? -> provider` had nothing
in the middle: `payment_attempts`, `payment_events`, and `refunds` did not
exist as tables, and the three real, live payment gateways (Banco Inter
Pix/boleto, Mercado Pago card, PagBank Apple Pay/Google Pay) all wrote
their state onto **WooCommerce orders**, not onto anything native. This
phase builds the missing middle -- a provider-neutral ledger the native
order aggregate (`orders`/`order_items`/... from
`20260903010000_native_order_foundation.sql`) can eventually attach to --
without touching a single gateway or removing WooCommerce.

## 2. Schema

Migration: `supabase/migrations/20260920000000_native_payment_ledger_foundation.sql`.
Drizzle mirror: `lib/db/schema/payments.ts`. Typed wrappers: `lib/db/nativePayment.ts`.

| Table | Purpose |
| --- | --- |
| `payment_attempts` | One row per logical charge attempt against a native order. A new charge (different method, retried after expiry) is a new row; a *retried creation* of the SAME logical attempt is not. |
| `payment_events` | Append-only ledger of every provider status observation (webhook delivery, reconciliation re-query, admin override). Never updated, never deleted. |
| `refunds` | One row per requested refund (full or partial). Several refund rows may exist per attempt. |

No auxiliary tables were added beyond these three (Section 6's own
"evitar overengineering" -- no `payment_methods`/`providers` lookup tables;
closed vocabularies are Postgres enums, matching the project's existing
convention for `order_status` etc.; no `integration_outbox` -- that is an
Olist-export concern the core-design doc scopes separately and this phase
does not touch).

Provider-specific identifiers (Inter txid, Mercado Pago payment id, PagBank
charge id) all live in one `provider_reference text` column scoped by
`provider`, never as separate provider-named columns (Section 14).

## 3. State machine

```text
created --> pending --> authorized --> paid --> partially_refunded --> refunded
   |           |             |                        ^
   v           v             v                        |
cancelled   failed/       failed/                partially_refunded (loop)
            cancelled/    cancelled
            expired
```

Concretely (`enforce_native_payment_attempt_status_transition`):

- `created -> {pending, cancelled}`
- `pending -> {authorized, paid, failed, cancelled, expired}` (Pix/boleto go straight to `paid`; card methods pass through `authorized` first -- both are valid from `pending`, the schema does not force one shape)
- `authorized -> {paid, failed, cancelled}`
- `paid -> {refunded, partially_refunded}`
- `partially_refunded -> {refunded, partially_refunded}` (multiple partial refunds)
- `failed`, `cancelled`, `expired`, `refunded` are terminal.

Enforced by a `BEFORE UPDATE OF status` trigger -- an invalid transition
raises `23514 invalid_payment_attempt_status_transition` even for a raw
`UPDATE` bypassing every function (defense in depth: `persi_app`/
`persi_worker` never actually have raw `UPDATE` grant on the table, but the
trigger holds regardless of who is connected). Optimistic concurrency uses
the same `version bigint` + expected-version pattern as `orders`/
`transition_native_order`; a stale caller gets `40001
stale_payment_attempt_transition`, never a silent overwrite.

`refunds.status` has its own, smaller machine
(`enforce_native_refund_status_transition`): `requested -> {processing,
cancelled}`, `processing -> {completed, failed}`.

## 4. Idempotency

Two independent mechanisms, both DB-enforced (not memory/application-only,
per Section 9's explicit preference):

1. **Creation**: `payment_attempts_idempotency_unique (provider,
   idempotency_key)` and `refunds_idempotency_unique (provider,
   idempotency_key)`. `create_native_payment_attempt`/`create_native_refund`
   use `INSERT ... ON CONFLICT DO NOTHING RETURNING *`, falling back to a
   `SELECT` of the existing row when the insert is swallowed by the
   constraint -- a retried creation call always returns the SAME logical
   row, never a second one, and never an error.
2. **Event dedupe**: `payment_events_external_dedupe_unique (provider,
   external_event_id)`. `record_native_payment_event` locks the target
   `payment_attempts` row first (serializing concurrent deliveries against
   each other), decides the processing result, then does the SAME
   `INSERT ... ON CONFLICT DO NOTHING` + fallback-select pattern for the
   event row itself. `external_event_id IS NULL` (internally-generated
   events -- reconciliation probes, manual overrides) never collides with
   anything, by ordinary SQL NULL semantics.

An earlier draft of `record_native_payment_event` checked for an existing
event with a plain, unlocked `SELECT` before inserting -- concurrent
deliveries of the identical event could both pass that check and then race
into the `INSERT`, raising a raw unique-violation instead of converging.
Caught by this phase's own concurrency harness
(`scripts/database/native-payment-ledger-concurrency.mjs`, property B) and
fixed by moving the dedupe check to use `ON CONFLICT DO NOTHING` like the
creation functions already did.

## 5. Reconciliation contract

The existing gateway-anchored-in-Woo pattern (`services/payments/reconcile.ts`:
never trust a webhook body as authority, always re-query the provider) is
**preserved as the documented contract** for the future gateway-reanchoring
phase -- not re-implemented here, since no provider is called in this
phase. `payment_events.processing_result` (`applied` / `duplicate_ignored`
/ `stale_ignored` / `rejected`) is designed so a future reconciliation
worker can tell, after the fact, whether its own re-query actually changed
anything or merely confirmed already-known state.

`record_native_payment_event`'s own state-machine check means an event
that would move an attempt **backwards** (e.g. a late "pending" webhook
arriving after the attempt is already `paid`) is recorded for audit
(`stale_ignored`) but never applied -- concurrent reconciliation and
webhook delivery converge on whichever one legitimately advances the state
machine first; neither can undo the other's success (harness property C).

## 6. Refunds

`create_native_refund` mirrors `create_native_payment_attempt`'s
idempotent-creation contract exactly. The **amount ceiling** (sum of
non-`failed`/non-`cancelled` refunds for one attempt must never exceed
that attempt's own `amount_minor`) is enforced by a trigger
(`enforce_refund_amount_ceiling`), not just a single-row `CHECK`, since it
is an aggregate, cross-row invariant a `CHECK` constraint cannot express.
When a refund transitions to `completed`, `transition_native_refund` itself
recomputes the attempt's total completed-refund amount and flips the
attempt to `partially_refunded` or `refunded` accordingly -- no separate
reconciliation step is needed for that specific propagation.

No provider is called to actually issue a refund in this phase (Section 11).

## 7. Order boundary

`orders.status` is `pending | confirmed | cancelled | completed` -- it has
**no payment-specific value at all**, and this phase deliberately does not
add one (Section 12: "não inventar estados incompatíveis com schema
existente"). The intended mapping for the future gateway-reanchoring phase:

| Payment event | Order transition |
| --- | --- |
| First attempt reaches `paid` | `pending -> confirmed` (via the existing `transition_native_order`) |
| An attempt `fails`/`expires`/is `cancelled` while others may still be retried | No automatic order transition -- the order stays `pending`, awaiting a possible new attempt |
| Every attempt for an order is exhausted with no success | `pending -> cancelled` (a decision, not a mechanical consequence -- left to the gateway-reanchoring phase's own orchestration logic) |
| A `refund`/`partial_refund` completes | Documented as **not** an order-status transition in the current `order_status` enum -- `orders` has no "refunded" state; this is an explicit gap (see below), not silently glossed over |

This phase does **not** implement a trigger wiring `payment_attempts`
directly to `orders` (Section 12's "evitar acoplamento fragil") -- the
mapping above is a designed contract, not yet enforced code, deliberately
left for the phase that actually has a live checkout submitting payments to
react to.

**Known gap**: refund completion has no corresponding native order state
today. If the future phase needs the order itself to reflect "refunded",
`order_status` will need a forward-only migration extending the enum (or a
separate `orders.payment_state` column) -- not decided or built here.

## 8. Inventory boundary

Already proven by the E2 requalification's own harness output
(`SUBMISSION_ON_HAND_DELTA=0`, `SUBMISSION_RESERVED_DELTA=0` across 400 real
concurrent cycles): `submit_native_checkout` **reserves** inventory
(`reserve_inventory`) at checkout time and does **not** decrement
`on_hand` during order creation. The natural, not-yet-wired boundary for
this new ledger:

| Payment state | Inventory action (existing functions, not called by this phase) |
| --- | --- |
| Order created, attempt `pending`/`authorized` | Reservation already exists from checkout; no new action |
| Attempt reaches `paid` | `confirm_inventory_reservation` (decrements `on_hand`, closes the reservation) |
| Attempt/order terminates with no successful payment (`failed`/`cancelled`/`expired`, and no other attempt succeeds) | `release_inventory_reservation` (frees the hold without decrementing `on_hand`) |
| A refund completes | Documented as **not** automatically re-reserving/incrementing inventory -- a real-world restock decision, explicitly out of scope for this phase and likely a manual/admin action even in the reanchored future |

No inventory schema change was needed or made -- `confirm_inventory_reservation`
and `release_inventory_reservation` already exist (`20260823110400_inventory.sql`)
and are reused as-is by this contract.

## 9. Provider-neutral adapter contract (for the future gateway-reanchoring phase)

The three EXISTING, LIVE gateway clients
(`services/payments/{inter,mercadopago,pagbank}/*.ts`) were read (not
modified, not called) to confirm this ledger's shape is compatible:

- Each gateway already returns its own status enum (`PixChargeStatus`,
  `BoletoChargeStatus`, `MercadoPagoChargeStatus`, `CardChargeStatus`) --
  none of these are reused directly as `payment_attempt_status`; a future
  adapter layer maps each provider's own status vocabulary onto this
  ledger's canonical one, exactly the "provider-neutral by design" goal.
- `provider_reference` is sized and shaped to hold any of: a Pix `txid`, a
  boleto identifier, a Mercado Pago `payment.id`, or a PagBank charge id --
  all opaque strings from this schema's point of view.
- The existing "never trust the webhook body, re-query the provider"
  pattern (`services/payments/reconcile.ts`) maps directly onto
  `record_native_payment_event`'s own contract: an adapter should call it
  with the RE-QUERIED, verified status, not the raw webhook payload.

No gateway code was changed. No provider was called.

## 10. Security boundary

Same idiom as `orders` (Section 15): RLS enabled on all three tables,
nothing granted to `public`/`anon`/`authenticated`, and mutation is
exclusively through `SECURITY DEFINER` functions:

| Function | Grantee | Why |
| --- | --- | --- |
| `create_native_payment_attempt` | `persi_app`, `persi_worker` | Initiating a payment is a legitimate customer-triggered, checkout-adjacent action |
| `create_native_refund` | `persi_app`, `persi_worker` | Same reasoning -- requesting a refund is a legitimate request to initiate, not to complete |
| `transition_native_payment_attempt` | `persi_worker` only | Only backend (webhook/reconciliation) authority may ever change a payment's status |
| `record_native_payment_event` | `persi_worker` only | Same -- only the backend records provider truth |
| `transition_native_refund` | `persi_worker` only | Same |

`persi_app` (the browser-facing role) can therefore never mark a payment
`paid`, insert a `payment_events` row, or move a refund forward --
confirmed by pgTAP (`supabase/tests/database/native_payment_ledger_foundation.test.sql`),
not merely asserted here.

## 11. Testing

- **pgTAP**: `supabase/tests/database/native_payment_ledger_foundation.test.sql`
  -- schema shape, RLS/privilege boundary, idempotent creation, every valid
  and invalid state transition (including a raw-`UPDATE`-bypass attempt),
  event dedupe (including the stale-backward-event and null-external-id
  cases), immutability, and the refund ceiling/propagation-to-attempt-status
  behavior.
- **Concurrency harness**: `scripts/database/native-payment-ledger-concurrency.mjs`
  -- real Postgres, real concurrent connections, proving the 6 properties
  Section 17 requires (idempotent creation under a real race, duplicate
  webhook delivery, concurrent reconciliation + webhook, duplicate refund,
  stale-transition rejection, and that no race can mark an attempt `paid`
  twice).

## 12. What this phase explicitly does NOT do

- Call Banco Inter, Mercado Pago, or PagBank.
- Handle a real webhook.
- Touch the checkout UI or activate native checkout runtime.
- Replace any WooCommerce-anchored payment code.
- Deploy anywhere, migrate staging, or touch production.
