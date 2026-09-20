# 87 — Staging Readiness Package (ACCELERATED — Track H)

Status: **read-only with respect to staging**. Nothing in this document or
this round touched staging DB, staging env, or performed a deploy. This is a
package for a separately authorized staging round to execute against.

## 1. What must be deployed

### 1.1 Migrations pending staging qualification

In order, forward-only, none rewriting a frozen/historical migration:

| Migration | Round | What it adds |
|---|---|---|
| `20260920000000_native_payment_ledger_foundation.sql` | Phase 3A (B.3-D) | `payment_attempts`, `payment_events`, `refunds`. |
| `20260921000000_shared_payment_order_inventory_orchestration.sql` | Phase 3A (B.3-H) | `apply_verified_payment_transition`. |
| `20260922000000_native_reservation_expiration_recovery.sql` | This round (Track A) | `reclaim_expired_native_reservations`. |

All three are additive (new functions/tables only), `SECURITY DEFINER` where
privilege boundaries required it, grants restricted to `persi_worker`. pgTAP
for all three passes locally (737 tests, `supabase test db`).

### 1.2 Code to deploy (this round's new files)

- `supabase/migrations/20260922000000_native_reservation_expiration_recovery.sql`
- `lib/db/nativePayment.ts` (additions: `reclaimExpiredNativeReservations`,
  `findNativePaymentAttemptByProviderReference`,
  `listStaleNativePendingPaymentAttempts`)
- `lib/db/nativeCheckoutPii.ts` (fix + `decryptNativeCheckoutPii` signature
  change), `lib/db/nativePriceAuthority.ts` (fix)
- `lib/commerce/reservationExpirationWorker.ts`,
  `lib/commerce/nativePaymentReconciliationWorker.ts`
- `lib/observability/nativeCommerceEvents.ts`
- `app/api/checkout/native/route.ts`
- `app/api/webhooks/native/{inter,mercadopago,pagbank}/route.ts`
- Test files: `tests/nativeCheckoutHttpBoundary.test.mjs`,
  `tests/nativeWebhookBoundary.test.mjs`
- Docs: `docs/database/80` through `86` (this file is `87`)

None of this activates anything: `isNativeCheckoutRuntimeEnabled()` is
hardcoded `false` in `lib/runtime/native-checkout-mode.ts`, independent of
`NATIVE_CHECKOUT_MODE`'s value. Deploying this code changes nothing about
live behavior — Stage 0 (Section 6).

### 1.3 Feature flags

- `NATIVE_CHECKOUT_MODE` (`off` | `shadow` | `canary`) — read, but its value
  has **no effect** yet; `isNativeCheckoutRuntimeEnabled()` must itself be
  changed (a code change, not an env change) before any mode other than the
  current permanent `off` behavior is possible. Flipping this is explicitly
  **not authorized** by this round.

## 2. Environment variables — names only, no values

Server-only (never a `NEXT_PUBLIC_` prefix), needed once native checkout is
ever authorized to run for real:

- `DATABASE_URL` — must resolve to a role holding (or granted membership in)
  both `persi_app` and `persi_worker` privileges. **See Section 3 — this is
  currently unresolved, predates this round, and is likely the single
  biggest blocker to any of this working in staging at all.**
- `CHECKOUT_PII_KEY_ID`, `CHECKOUT_PII_ENCRYPTION_KEYS_JSON` — checkout PII
  envelope encryption (`lib/commerce/checkoutPii.ts`).
- `ORDER_TAX_DOCUMENT_KEY_ID`, `ORDER_TAX_DOCUMENT_ENCRYPTION_KEYS_JSON`,
  `ORDER_TAX_DOCUMENT_HMAC_KEY` — durable tax-document encryption
  (`lib/commerce/taxDocumentCrypto.ts`) — **not actually usable yet**, see
  Section 4.3.
- `CRON_SECRET` — already exists for the legacy `expire-pending-payments`
  cron; a future native expiration/reconciliation cron route would need the
  same (or a dedicated) secret.
- `CHECKOUT_STAGING_DRY_RUN_SECRET` — already exists for the legacy payment
  route's dry-run header; not yet wired into the native route.
- Provider credentials already required by the existing (Woo-anchored)
  integrations, unchanged by this round: Banco Inter mTLS cert/key + OAuth
  client id/secret, Mercado Pago access token, PagBank token.

## 3. The pre-existing role/credential gap (not introduced by this round)

`persi_app`, `persi_worker`, `persi_readonly` are created `NOLOGIN`
(`20260901120000_shipping_core.sql`), by design — they're privilege-grouping
roles, not something anything connects AS directly. That migration's own
comment defers "credenciais de login" (login credentials mapping a real
connecting role to these groups) as **out of scope** for that phase, and no
migration since has resolved it. Locally, every script/test in this
engagement runs as the Postgres superuser, which bypasses grants entirely —
masking this gap in every local proof to date, including this round's own.

**Concretely**: `apply_verified_payment_transition` and this round's
`reclaim_expired_native_reservations` are both granted `EXECUTE` to
`persi_worker` only. Until whatever role `DATABASE_URL` connects as in
staging/production is granted membership in `persi_worker` (`GRANT
persi_worker TO <connecting_role>;`), calling either function will fail with
a permission error — not a logic bug, a missing grant. **Classified
`BLOCKING_FOR_STAGING`** — verify and resolve this before Stage 1.

## 4. Known, explicitly-documented gaps (not silently worked around)

### 4.1 Native customer identity (Track C, §2.2 of [84](84-native-http-checkout-boundary.md))

No resolver from an authenticated WooCommerce/account session to a native
`customers` table row exists. `app/api/checkout/native/route.ts` supports
guest checkout only. **`BLOCKING_FOR_STAGING`** if authenticated native
checkout is required for the first canary; **`OPERATIONAL_FOLLOWUP`** if
guest-only is acceptable for an initial canary slice.

### 4.2 Pending reservation expiration/recovery execution mechanism

`processExpiredNativeReservations()` (Track A) exists and is proven against
real Postgres, but no cron route calls it. Wiring one is mechanical (mirror
`app/api/cron/expire-pending-payments/route.ts`'s auth/overlap-guard
pattern) but is not done this round. **`STAGING_EXECUTION_REQUIRED`** (needs
an external scheduler to actually call it periodically once the route
exists — cannot be exercised offline).

### 4.3 Tax document encryption timing (Track C, §2.3)

`encryptDurableTaxDocument`'s AAD binds to `orderId`, but
`submitNativeCommerceCheckout` generates that id internally. No native order
today carries an encrypted tax document. Resolving this (two-phase
encrypt-after-create, or a redesigned AAD) is a real design decision.
**`OPERATIONAL_FOLLOWUP`** — CPF/CNPJ isn't required for order fulfillment
correctness, only for fiscal documentation, which can be backfilled once
solved.

### 4.4 Reconciliation worker execution mechanism

Same shape as 4.2: `processNativePendingReconciliation()` (Track D) exists,
proven, unwired to any scheduler. **`STAGING_EXECUTION_REQUIRED`**.

### 4.5 Webhook subscriptions

`app/api/webhooks/native/{inter,mercadopago,pagbank}/route.ts` exist but no
provider console anywhere points a real webhook subscription at them.
**`STAGING_EXECUTION_REQUIRED`** — provider sandbox webhook registration
cannot be exercised offline.

### 4.6 `externalEventId` scheme for native webhooks

Track D's routes derive it from a digest of `(provider, reference, raw
body)` in the absence of a reliable provider-supplied delivery id. Reasoned
default, not proven optimal — affects `payment_events` audit-log tidiness
only, not correctness (see [85](85-native-webhook-reconciliation-readiness.md)
§2.2). **`OPERATIONAL_FOLLOWUP`**.

### 4.7 Rate limiting on the native checkout route

Not added this round; `assertPaymentsAllowed` (existing policy gate) is the
only defense-in-depth layer beyond the runtime flag. **`OPERATIONAL_FOLLOWUP`**
unless staging load-testing shows it's needed sooner.

## 5. Woo-coexistence strategy

Every legacy route (`app/api/checkout/payment/route.ts`, the three legacy
`app/api/webhooks/*/route.ts`, `app/api/cron/expire-pending-payments/route.ts`)
is untouched, verified by `tests/nativeWebhookBoundary.test.mjs`'s explicit
check that the legacy routes still call `reconcilePaymentReference` and
never an `applyNative*WebhookNotification`. WooCommerce remains the sole
live order path for the entirety of this round and will remain so until a
separately authorized round flips `isNativeCheckoutRuntimeEnabled()` and
begins a canary. No Woo dependency was removed, weakened, or bypassed.

## 6. Staged activation plan (conceptual — adapt at execution time)

- **Stage 0** — deploy this round's code with native mode fully inert (as
  today: `isNativeCheckoutRuntimeEnabled()` hardcoded `false`). Verify build/
  typecheck/lint pass in the staging CI pipeline exactly as they do locally.
- **Stage 1** — schema qualification: apply the 3 migrations
  (Section 1.1) to staging Postgres; re-run the pgTAP suite there.
- **Stage 2** — resolve the role/credential gap (Section 3); confirm
  `apply_verified_payment_transition` and `reclaim_expired_native_reservations`
  are actually callable by whatever role the app authenticates as.
- **Stage 3** — sandbox provider credentials configured (Inter/MP/PagBank
  sandbox, per Section 2); internal health checks pass without a real
  charge.
- **Stage 4** — a single controlled, manually-triggered native checkout
  transaction end-to-end in staging (requires flipping
  `isNativeCheckoutRuntimeEnabled()` for staging only — a code change this
  round does not make).
- **Stage 5** — register real sandbox webhook URLs with each provider,
  confirm `native_webhook_received`/`native_webhook_reconciliation_applied`
  events fire correctly for a real sandbox charge.
- **Stage 6** — wire and schedule the expiration/reconciliation cron routes
  (Sections 4.2/4.4); confirm they run on their own schedule without manual
  triggering.
- **Stage 7** — limited canary, native customer identity gap resolved or
  explicitly accepted as guest-only for the canary slice.

## 7. Rollback strategy

- Code: revert the deploy; `isNativeCheckoutRuntimeEnabled()` was never
  flipped, so there is no runtime state to unwind.
- Schema: the 3 migrations are purely additive (new functions/tables, no
  altered/dropped existing objects) — no data migration to reverse. Their
  functions simply go unused if the code deploy is rolled back first.
- No irreversible action (real order, real payment, real webhook
  subscription) is possible without Stage 4+ having already happened, each
  gated behind an explicit, separate authorization.

## 8. Smoke test sequence (once Stage 3 is reached)

1. `POST /api/checkout/native` with a prepared checkout → expect 404
   (`NATIVE_CHECKOUT_DISABLED`) until Stage 4's flag flip.
2. After the flip, a single Pix submission → verify `payment_attempts`,
   `inventory_reservations`, `orders` rows created; provider sandbox charge
   created; no legacy Woo order created.
3. Simulate/await a real sandbox Pix confirmation → confirm the native
   webhook route reconciles it, order transitions to `confirmed`.
4. Manually invoke (before a scheduler exists) `processExpiredNativeReservations`
   and `processNativePendingReconciliation` against staging to confirm they
   run without error against real (not synthetic) data.
5. Confirm the legacy Woo checkout path is completely unaffected throughout
   (place one ordinary Woo order before/after, confirm no behavior change).

## 9. Release classification summary

```
BLOCKING_FOR_STAGING:
  - persi_worker/persi_app login-role credential gap (Section 3)
  - native customer identity resolution, if authenticated checkout is
    required for the first canary (Section 4.1)

STAGING_EXECUTION_REQUIRED:
  - provider sandbox smoke tests (cannot run offline)
  - webhook subscription registration (Section 4.5)
  - expiration/reconciliation cron wiring + scheduling (Sections 4.2/4.4)
  - a single controlled native transaction (Stage 4)

BLOCKING_FOR_PRODUCTION (beyond the staging list above):
  - real provider sandbox qualification results
  - webhook signature verification decision for Mercado Pago/PagBank (none
    exists today, legacy or native)
  - reconciliation and expiration workers running unattended and proven
    stable over time in staging
  - Olist integration decision (OPERATIONAL_FOLLOWUP per docs/database/82,
    but paid orders being invisible to fulfillment without it IS a real
    production go-live blocker, distinct from payment/inventory safety)
  - transactional email decision (docs/database/83) — orders can be
    payment-safe without it, but customers receiving no confirmation email
    is a real launch blocker for a public canary
  - refund/chargeback operational procedure (no capability exists for any
    of the three providers' native paths)
  - rollback/monitoring runbooks written and rehearsed

POST_V1 (explicitly not blocking, with reasoning):
  - tax document encryption timing (Section 4.3) — fiscal documentation,
    not payment/inventory correctness
  - native externalEventId scheme refinement (Section 4.6) — audit-log
    tidiness only, correctness already proven independent of it
  - rate limiting on the native route (Section 4.7) — no evidence yet that
    load requires it before other blockers are resolved
  - broader observability (correlation IDs threaded end-to-end, dashboards)
  - native thank-you page UI (contract already frozen, Section 21 of the
    program spec explicitly defers building it)
```

`SAFE_TO_EXECUTE_STAGING_QUALIFICATION = YES` for Stages 0–1 specifically
(deploy + schema qualification) — nothing in those two stages requires
resolving Section 3's gap first. Stage 2 onward requires it.
`SAFE_TO_PRODUCTION = NO`, unconditionally, regardless of this round's
results.
