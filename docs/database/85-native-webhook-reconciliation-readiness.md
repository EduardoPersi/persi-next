# 85 — Native Webhook + Reconciliation Readiness (ACCELERATED — Track D)

Status: **foundations prepared, not exposed**. No live public webhook
behavior was changed. `NATIVE_CHECKOUT_RUNTIME_ENABLED` stays `NO`.

## 1. Why this exists

[79-native-checkout-payment-wiring.md](79-native-checkout-payment-wiring.md)
§11 already established that the native-side verification logic
(`applyNative*WebhookNotification`, `reconcileNative*PendingAttempt` in the
three `services/payments/*/nativeAdapter.ts`) exists and is tested, but
nothing calls it from a route or a scheduler — `NATIVE_WEBHOOK_INTERNAL_
WIRING_READY = YES` (qualified, not exposed) and `NATIVE_RECONCILIATION_
WIRING_READY = YES` (mock-only, no cron). This round builds the missing
HTTP entrypoints and the reconciliation worker's batch shape, **without**
touching the three live webhook routes or the live cron, which stay
untouched and wired exclusively to the legacy WooCommerce flow — the spec's
own hard rule ("if changing current public webhook behavior is required: DO
NOT DO IT").

## 2. What was built

### 2.1 Lookup primitive

`lib/db/nativePayment.ts` gained `findNativePaymentAttemptByProviderReference(provider, providerReference)`
— the one piece nothing before this round built: given the charge/payment
reference a webhook body carries (the only thing ever extracted from it),
find which `payment_attempt` it belongs to. Returns `null` on a miss rather
than throwing (an unrecognized reference is not an error — could belong to a
legacy Woo-anchored charge, which this route correctly ignores).

### 2.2 Three new, separate webhook routes

`app/api/webhooks/native/{inter,mercadopago,pagbank}/route.ts`. Each:

- Fails closed the same way Track C's checkout route does
  (`isNativeCheckoutRuntimeEnabled()` → 404).
- Extracts and format-validates only a charge/payment reference from the
  body (identical regexes to the legacy routes: `TXID_PATTERN`,
  `REQUEST_CODE_PATTERN`, `PAYMENT_ID_PATTERN`, `CHARGE_ID_PATTERN`) — the
  webhook body is **never** payment authority; the actual status always
  comes from `applyNative*WebhookNotification`'s own provider re-query
  (unchanged from the existing, already-qualified adapters).
- Looks up the matching `payment_attempt` via §2.1; a miss is a silent
  no-op (200), not an error.
- Uses a SHA-256 digest of `(provider, reference, raw body)` as
  `externalEventId` for `payment_events` dedupe. None of the three providers
  gives a reliable webhook-delivery identifier (Inter doesn't sign this
  payload at all — see [75](75-native-inter-gateway-reanchoring.md) §8;
  Mercado Pago/PagBank webhooks aren't signed here either), so this is a
  reasonable default, **flagged for staging review**, not a proven-optimal
  choice. It only affects payment_events audit-log tidiness, not
  correctness: `apply_verified_payment_transition`'s own before/after
  version check is what actually makes a replay a safe no-op (proven for
  `reconciliation_probe` calls, which already pass `externalEventId: null`
  today).
- The three **live** routes (`app/api/webhooks/{inter,mercadopago,pagbank}/route.ts`)
  are byte-for-byte untouched — verified by `tests/nativeWebhookBoundary.test.mjs`,
  which asserts they still call `reconcilePaymentReference` (Woo-anchored)
  and never call an `applyNative*WebhookNotification` function.

No real webhook subscription in any environment points at these new URLs —
wiring one at the provider console is a staging task
([86](86-staging-readiness-package.md)), not something this round activates.

### 2.3 Reconciliation worker

`lib/commerce/nativePaymentReconciliationWorker.ts`'s
`processNativePendingReconciliation()` — same bounded-batch, time-budgeted
shape as [80](80-native-reservation-expiration-recovery.md)'s
`processExpiredNativeReservations` and the existing
`services/payments/cronReconciliation.ts`'s `reconcilePendingOrders`. Backed
by a new read-only query, `lib/db/nativePayment.ts`'s
`listStaleNativePendingPaymentAttempts(olderThanMs, batchSize)` (attempts in
`pending`/`authorized` with a `provider_reference`, untouched for longer than
the given window). Dispatches each stale attempt to the correct provider's
already-tested `reconcileNative*PendingAttempt` — no new payment-verification
logic, only iteration and dispatch. No scheduler/cron route wired this round.

**`staleAfterMs` default is 15 minutes — a starting point, not a tuned
value.** Staging should set this per the actual margin above each payment
method's own provider-side expiry window, the identical caveat
[80](80-native-reservation-expiration-recovery.md) already documents for
`inventory_reservations.expires_at`.

## 3. Properties proven

`scripts/database/native-accelerated-wrappers-regression.mjs` (real local
Postgres) — closes a gap noticed while writing this track: Track A's own
concurrency script called the SQL functions directly, never the TS wrapper
functions themselves. This script proves, against real Postgres, that:

- `reclaimExpiredNativeReservations` (the TS wrapper) actually releases a
  real expired reservation.
- `processExpiredNativeReservations` (the worker) does too, end-to-end.
- `findNativePaymentAttemptByProviderReference` finds a real attempt by its
  reference and returns `null` for an unknown one.
- `listStaleNativePendingPaymentAttempts` finds a real stale attempt.
- `processNativePendingReconciliation` dispatches that real stale attempt to
  an injected `reconcileByProvider` (avoiding a real provider call in this
  proof, consistent with every other script in this engagement).

All properties `true`; `ALL_PASS: true`.

`tests/nativeWebhookBoundary.test.mjs` (static source assertions, same
established convention as `tests/checkoutPaymentHealth.test.mjs` and
`tests/nativeCheckoutHttpBoundary.test.mjs` — see
[84](84-native-http-checkout-boundary.md) §5 for why a live `POST` call
isn't reachable from `npm test`): fail-closed on all three routes, legacy
routes provably untouched, no fabricated status forwarded to the ledger,
lookup always precedes verification, no raw webhook payload logged. All 6
pass.

`NATIVE_WEBHOOK_STAGING_READY` = the routes/lookup exist and are tested, but
are not reachable by any real provider yet (no subscription wired) —
classified `STAGING_EXECUTION_REQUIRED`, not a local pass/fail gate (a
provider console webhook-URL registration cannot be exercised offline).
`NATIVE_RECONCILIATION_WORKER_READY = YES` (real-DB proven this round, no
scheduler wired).

## 4. What this round does NOT do

- Does not modify any live webhook route or the live cron.
- Does not register any webhook URL with Inter/Mercado Pago/PagBank.
- Does not wire a scheduler/cron to `processNativePendingReconciliation`.
- Does not resolve the `staleAfterMs`/reservation-`expires_at` tuning
  question — an operational decision for staging, not invented here.
- Does not add HMAC/signature verification for Mercado Pago/PagBank webhooks
  (the legacy routes don't have it either, and adding it would be new
  provider-integration scope, not a native-commerce wiring task).
