# 76 — Native Mercado Pago (Card) Gateway Reanchoring (B.3-F)

Status: **qualified, not live**. No real Mercado Pago call, no runtime
activation, no WooCommerce change. New files only:
[`services/payments/mercadopago/nativeAdapter.ts`](../../services/payments/mercadopago/nativeAdapter.ts),
[`tests/paymentsMercadoPagoNativeAdapter.test.mjs`](../../tests/paymentsMercadoPagoNativeAdapter.test.mjs),
[`scripts/database/native-mercadopago-payment-concurrency.mjs`](../../scripts/database/native-mercadopago-payment-concurrency.mjs).
Every existing Mercado Pago/WooCommerce file is untouched (`git status`
confirms only the new adapter file — Section 8).

This is the card-only sibling of
[75-native-inter-gateway-reanchoring.md](75-native-inter-gateway-reanchoring.md);
sections here assume that document's context (the payment ledger, the claim
gate, the "webhook != authority" principle) and focus on what is different
for card. PagBank (Apple Pay/Google Pay) is explicitly a separate, later
phase — not touched here.

## 1. PROVIDER_LOGIC vs WOO_ANCHORING vs CHECKOUT_UI_CONCERNS

| File / concern | Classification | Reused as-is? |
|---|---|---|
| `services/payments/mercadopago/client.ts` (`mercadopagoRequest`, `X-Idempotency-Key` header, timeout/error handling) | PROVIDER_LOGIC | Yes, unchanged |
| `services/payments/mercadopago/charge.ts` (`createCardCharge`, `getCardChargeStatus`, status validation) | PROVIDER_LOGIC | Yes, unchanged, called directly |
| `services/payments/mercadopago/errors.ts` (`MercadoPagoPaymentError`) | PROVIDER_LOGIC | Yes, unchanged |
| Card tokenization (SDK issuing `cardToken` before it ever reaches the backend) | CHECKOUT_UI_CONCERN | Not touched — out of scope, already token-only by construction |
| `app/api/checkout/payment/route.ts`: `referenceId: String(order.id)` | WOO_ANCHORING | Not reused — native path uses the native `orderId` (UUID) instead |
| `services/woocommerce/orders.ts` (`createPendingOrder`, `attachPaymentReference`, `markOrderAsPaid`, `markOrderAsFailed`) | WOO_ANCHORING | Not called |
| `services/payments/reconcile.ts`: `categorizeMercadoPagoCardStatus` | Pure PROVIDER_LOGIC re-derived (see Section 3); `reconcilePaymentReference` itself is WOO_ANCHORING, not called | Categorization logic re-derived for the ledger's vocabulary |
| `app/api/webhooks/mercadopago/route.ts` | WOO_ANCHORING (calls `reconcilePaymentReference`) | Not modified; its "id-only from the body, always re-query" principle is carried over |

One correction to an initial assumption, same shape as the Inter round: the
legacy path's `input.idempotencyKey` (passed straight to Mercado Pago as
`X-Idempotency-Key`) was **already** checkout-scoped, not Woo-order-id
derived. Only `referenceId` (used for `external_reference` and the
human-readable `description` sent to Mercado Pago) is genuinely
Woo-anchored.

## 2. PCI boundary (Section 5)

The existing `CreateCardChargeInput.cardToken` type has never accepted a
PAN/CVV — tokenization already happens client-side (Mercado Pago SDK) before
any backend code runs. `nativeAdapter.ts` passes `cardToken` straight
through to `createCardCharge` and never reads it back, logs it, or writes it
anywhere. `payment_attempts`/`payment_events` have no column for a card
token; only `chargeId` (provider reference), `brand`, `lastDigits` and
`installments` are used anywhere — the exact same fields the legacy
`attachPaymentReference` already persists, nothing broader.
`MP_CARD_TOKEN_PERSISTED = NO`.

## 3. Deterministic identity (Sections 7–8)

- **Idempotency key**: `deriveNativeMercadoPagoIdempotencyKey(paymentAttempt.idempotencyKey)` —
  the ledger's own `payment_attempts.idempotency_key` passed straight through
  as Mercado Pago's `X-Idempotency-Key` header value (no transformation
  needed; Mercado Pago places no format constraint on it beyond being a
  stable string). Survives HTTP retry, local timeout, checkout retry and
  process restart because it lives in Postgres, not memory — exactly the
  ledger's own idempotent-create guarantee.
- **`referenceId`** (used only for `external_reference`/description, not
  idempotency): the native `orderId` (UUID) — never `order.id` (Woo).

## 4. Duplicate-charge safety and the claim gate (Section 9)

Mercado Pago's `client.ts` **already sends** `X-Idempotency-Key` on every
`createCardCharge` call — a real provider-side idempotency mechanism, unlike
Inter's Boleto (a bare `POST` with no such support, the source of the real
race documented in [75, Section 5.1](75-native-inter-gateway-reanchoring.md#51-boleto-creation-race-found-before-any-code-shipped--via-reasoning-about-create_native_payment_attempts-idempotency-together-with-boletos-non-idempotent-post)).
This module still applies the **same claim gate** (`created -> pending`, no
reference yet, before any provider call) uniformly, for two reasons: (1) it
gives a cheap, local, non-network guarantee that does not depend on trusting
the provider's own idempotency-key handling being bug-free, and (2) it keeps
the two native card-family adapters (Inter, Mercado Pago) structurally
identical rather than one relying on a provider detail the other cannot.
Proven under real concurrency:
`concurrentCreateOneProviderInvocationGate` (only one of two concurrent
callers may win the claim) and `duplicateCardCreateOneLogicalAttempt`
(idempotent-create itself) in
`scripts/database/native-mercadopago-payment-concurrency.mjs`.

## 5. Timeout ambiguity (Section 10) — a real difference from Inter Boleto

Section 17 of the Inter round designed `NativeInterBoletoAmbiguousRetryError`
specifically because Boleto's `POST` has no idempotency support: a
sequential retry after an ambiguous timeout could create a second, real
charge with no way to detect it. **Mercado Pago's situation is materially
different**: its own idempotency-key mechanism (already used unchanged by
the legacy integration) is specifically designed so a retried `createCardCharge`
call with the SAME key, after a timeout, returns the already-created
payment instead of charging twice.

This module treats that as a **documented trust boundary** — not verified
against the real API this round (no real Mercado Pago call is made
anywhere) — and, unlike Boleto, **does** allow `createNativeMercadoPagoCardPayment`
to resume from `pending` with no `provider_reference` by simply re-calling
the provider with the same idempotency key. There is no
`NativeInterBoletoAmbiguousRetryError` equivalent here; this is a considered
decision based on a real difference in the underlying provider contract, not
an oversight. If this trust turns out to be unwarranted (a future real
sandbox test contradicts it), the fix is to adopt the exact same
ambiguous-retry-blocking pattern already implemented for Boleto — the two
adapters are structurally close enough that this would be a small,
well-precedented change.

## 6. Status normalization (Section 11)

| Mercado Pago status (from `charge.ts`'s own validated union) | Ledger status |
|---|---|
| `approved` | `paid` |
| `authorized` | `authorized` (the ledger already has this exact state — fits without inventing anything) |
| `in_process`, `pending` | `pending` |
| `rejected` | `failed` |
| `cancelled` | `cancelled` |
| `refunded` | `refunded` |
| `charged_back` | `refunded` (**documented approximation** — a chargeback is a bank-initiated reversal with no corresponding `refunds` ledger row, unlike a real refund; the ledger has no distinct chargeback state and Section 11 forbids inventing one for convenience, so the closest existing state is used, imperfect as it is) |

`status_detail` is **not currently exposed** by `CardChargeResult` (the
existing `toChargeResult` in `charge.ts` never reads it from the provider
response) — Section 12 only prohibits it from becoming canonical state,
which is trivially true here because nothing in this round reads it at all.
Extracting it for retry-classification/diagnostics (its intended use) would
require a small, separately-authorized extension to `charge.ts`'s response
type — not done this round, to avoid refactoring the legacy file.
Documented as a known, honest gap rather than worked around.

## 7. Webhook, dedupe, reconciliation (Sections 13–15)

Identical shape to Inter (`docs/database/75`, sections 6): the webhook
body's claimed status is **never read** by `applyNativeMercadoPagoWebhookNotification`
— only `providerReference` (identifies the charge) and `externalEventId`
(dedupe only) are accepted; the recorded `resultingStatus` always comes from
`verifyNativeMercadoPagoPaymentStatus`, a fresh `getCardChargeStatus` call.
Duplicate/out-of-order webhook correctness is inherited unchanged from
`record_native_payment_event`. Proven Mercado-Pago-shaped in
`scripts/database/native-mercadopago-payment-concurrency.mjs`:
`duplicateWebhookOneEffect`, `webhookAndReconciliationDeterministic`,
`staleTransitionNeverRegresses`, `concurrentPaidTransitionOneLogicalState`.

## 8. Order boundary (Section 17) — qualified only

Same mapping as Inter (`docs/database/75`, section 7): `paid` →
`transition_native_order(pending -> confirmed)`; terminal failure → `pending
-> cancelled`. No new `orders.status` value invented. The known gap (no
"refunded" order state) is unchanged from the ledger round — not resolved
here, no migration created for it (this round required a HARD STOP before
any such migration, and no code path in this round needs one).

## 9. Refund/cancellation capability (Section 16)

`services/payments/mercadopago/charge.ts` has **no** refund or cancellation
function — only the charge-status *value* `refunded` is recognized as
something the provider might report (e.g. an admin-side action in the
Mercado Pago dashboard), but nothing here can *initiate* one.
`MP_REFUND_CAPABILITY = NOT_IMPLEMENTED_IN_EXISTING_INTEGRATION`, reported
honestly. Concurrency property G (duplicate refund) is explicitly skipped
in the harness for the same reason — not invented.

## 10. Inventory boundary (Section 18)

Reuses, unchanged, the exact blocker documented in
[75, Section 7](75-native-inter-gateway-reanchoring.md#7-order-boundary-section-13-and-inventory-boundary-section-14--qualified-not-wired):
`confirm_inventory_reservation`/`release_inventory_reservation` are
`SECURITY INVOKER` and granted to neither `persi_app` nor `persi_worker`.
This is a **shared** payment-orchestration concern, not specific to Mercado
Pago — no Mercado-Pago-specific workaround was created, no grant or
`SECURITY DEFINER`/`INVOKER` change was made.
`MERCADO_PAGO_INVENTORY_BOUNDARY = BLOCKED_BY_SHARED_PAYMENT_ORCHESTRATION`.
Per Section 18, this does not fail the card adapter itself.

## 11. Legacy regression (Section 20)

`git status` on every legacy Mercado Pago/Woo file
(`services/payments/mercadopago/{charge,client,errors}.ts`,
`services/payments/gateway.ts`, `services/woocommerce/orders.ts`,
`services/payments/reconcile.ts`, `app/api/webhooks/mercadopago/route.ts`,
`app/api/checkout/payment/route.ts`) shows zero changes. Existing tests
(`tests/paymentsMercadoPago*.test.mjs`-equivalent coverage inside
`tests/paymentsReconcile.test.mjs`, `tests/paymentsWooOrders.test.mjs`,
`tests/checkoutPaymentConfirmation.test.mjs`, etc.) pass unchanged.
`MERCADO_PAGO_LEGACY_PATH_PRESERVED = YES`.

## 12. Testing

- `tests/paymentsMercadoPagoNativeAdapter.test.mjs` — 13 unit tests: key
  derivation, full status-union normalization, error-category normalization,
  card creation (fresh, retry-safe, claim-race-lost, ambiguous-timeout-resume-allowed,
  synchronous-rejection-applied-as-failed, provider-timeout), webhook
  verification, reconciliation.
- `scripts/database/native-mercadopago-payment-concurrency.mjs` — 6
  properties (A–F) against real local Postgres, no provider called; G
  (duplicate refund) explicitly skipped and documented (Section 9).
- Regression: pgTAP 666/666 unchanged; full `npm test` 1385/1386 (the one
  pre-existing, unrelated `tests/instagramFeed.test.mjs` failure, predating
  both this round and the Inter round, still not investigated — out of
  scope); the Inter (`native-inter-payment-concurrency.mjs`) and Phase 2
  (`native-payment-ledger-concurrency.mjs`) harnesses re-run clean, no
  regression. Two hardcoded provider-reference literals left over from the
  Inter round's own harness (`REQ-D`, `TXID-E`) were found to collide with
  themselves on a second run against the persistent local database (not a
  logic bug in the adapter or the ledger — a harness-fixture bug) and fixed
  to use per-run random suffixes, matching the fix applied to this round's
  own Mercado Pago harness for the identical reason.

## 13. What this round does NOT do

- No call to a real Mercado Pago endpoint, sandbox or production.
- No wiring into the checkout flow.
- No inventory-reservation wiring (shared blocker, unchanged).
- No order-status transition wiring (qualified only).
- No refund implementation (no existing capability to wire).
- No `status_detail` extraction (would need a small legacy-file extension,
  not made this round).
- No feature flag.
- No change to the payment ledger migration or to any legacy Mercado
  Pago/WooCommerce file.
