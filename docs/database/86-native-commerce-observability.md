# 86 — Native Commerce Observability (ACCELERATED — Track E)

Status: **minimum observability added, scoped to this round's own new
code**. No dashboards, no new dependency, no retrofit of already-qualified
legacy-adjacent files.

## 1. What exists today, and what didn't

No `lib/logging`-style module exists anywhere in this codebase. Logging is
ad hoc `console.error`/`console.info`, consistently shaped as
`"[tag]" + { code, ...fields }` — the same pattern repeated across
`app/api/webhooks/*/route.ts`, `app/api/cron/expire-pending-payments/route.ts`,
and `services/payments/*/client.ts`. There is no correlation/request-id
propagation anywhere between a webhook call, the reconciliation it triggers,
and the log lines each emits — every call is independent.

## 2. What was added

[`lib/observability/nativeCommerceEvents.ts`](../../lib/observability/nativeCommerceEvents.ts):
one function, `logNativeCommerceEvent(name, fields)`. It follows the
existing `"[tag]" + object` convention rather than inventing a structured
logger this codebase has never used, and:

- Is wrapped in `try/catch` — a logging failure (e.g. a caller accidentally
  passing a circular structure) can never propagate into a commerce-
  correctness code path.
- Has a closed, named event vocabulary (`NativeCommerceEventName`), matching
  the spec's suggested names where they fit this codebase's actual
  boundaries: `native_checkout_submission_{rejected_runtime_disabled,failed,succeeded}`,
  `native_reservation_expiration_batch_completed`, `native_webhook_received`,
  `native_webhook_reconciliation_applied`, `native_webhook_processing_failed`,
  `native_reconciliation_batch_completed`.
- Has a closed, named field allow-list (`NativeCommerceEventFields`) enforced
  at the **type** level: it declares no field shaped like a card/wallet
  token, provider secret, certificate, authorization header, or full raw
  webhook payload, so passing one is a compile error, not a runtime
  redaction step someone could forget to call.
- Uses `checkoutId`/`orderId`/`paymentAttemptId` as correlation identifiers
  (all opaque UUIDs, never PII).

## 3. Where it was wired in

Scoped deliberately to this round's own new code, not existing
already-qualified files:

- [`lib/commerce/reservationExpirationWorker.ts`](../../lib/commerce/reservationExpirationWorker.ts) —
  one `native_reservation_expiration_batch_completed` per
  `processExpiredNativeReservations()` call.
- [`lib/commerce/nativePaymentReconciliationWorker.ts`](../../lib/commerce/nativePaymentReconciliationWorker.ts) —
  one `native_reconciliation_batch_completed` per
  `processNativePendingReconciliation()` call.
- [`app/api/checkout/native/route.ts`](../../app/api/checkout/native/route.ts) —
  `native_checkout_submission_rejected_runtime_disabled` on the fail-closed
  path, `native_checkout_submission_succeeded`/`_failed` on the two other
  outcomes (replacing the ad hoc `console.error` this file had during Track
  C, now routed through the shared helper for consistency).
- `app/api/webhooks/native/{inter,mercadopago,pagbank}/route.ts` —
  `native_webhook_received` on every call, `native_webhook_reconciliation_applied`
  per successfully-verified reference, `native_webhook_processing_failed` on
  a provider re-query failure (same replacement of the ad hoc
  `console.error` these files had during Track D).

**Not retrofitted**: the three *live* legacy webhook routes, the live cron,
`services/payments/*/nativeAdapter.ts`, and `services/checkout/nativeCheckoutService.ts`
keep whatever logging they already had. Retrofitting already-qualified,
previously-tested files with a new logging call is exactly the kind of
unrelated-scope change Section 27 warns against; if a future round decides
broader native-commerce observability is worth the diff, that's a
deliberate, separate decision — not bundled into this one.

## 4. Proof

`scripts/database/native-accelerated-wrappers-regression.mjs` (Track D's
script, re-run after this wiring) shows both worker events firing correctly
against real Postgres (`native_reservation_expiration_batch_completed`,
`native_reconciliation_batch_completed`) with accurate counts. `tests/nativeWebhookBoundary.test.mjs`
gained a test asserting every native webhook route emits both
`native_webhook_received` and `native_webhook_reconciliation_applied`.
`tests/nativeCheckoutHttpBoundary.test.mjs`'s C8 test was updated to check
for the new `logNativeCommerceEvent("native_checkout_submission_failed"`
call instead of a raw `console.error`, still confirming no card/wallet token
is ever part of what's logged. `npm test`: 1418/1419 (the one failure is the
same pre-existing, unrelated Instagram test noted in
[81](81-drizzle-datetime-error-cause-audit.md)).

`NATIVE_COMMERCE_OBSERVABILITY_MINIMUM_READY = YES` for the code this round
touched. Broader native-commerce observability (structured correlation IDs
threaded end-to-end, a real log aggregator, dashboards) remains `POST_V1`,
not attempted here.
