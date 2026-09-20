# 77 — Native PagBank (Apple Pay + Google Pay) Gateway Reanchoring (B.3-G)

Status: **qualified, not live**. No real PagBank call, no runtime
activation, no WooCommerce change. New files only:
[`services/payments/pagbank/nativeAdapter.ts`](../../services/payments/pagbank/nativeAdapter.ts),
[`tests/paymentsPagBankNativeAdapter.test.mjs`](../../tests/paymentsPagBankNativeAdapter.test.mjs),
[`scripts/database/native-pagbank-payment-concurrency.mjs`](../../scripts/database/native-pagbank-payment-concurrency.mjs).
Every existing PagBank/WooCommerce file is untouched (`git status` confirms
only the new adapter file — Section 11).

This is the wallet sibling of
[75-native-inter-gateway-reanchoring.md](75-native-inter-gateway-reanchoring.md)
and [76-native-mercadopago-gateway-reanchoring.md](76-native-mercadopago-gateway-reanchoring.md);
sections here assume that context and focus on what is different for
PagBank/wallets.

## 1. Capability gate — read from the code, not assumed

`services/payments/pagbank/charge.ts` has **one** `createCardCharge`
function serving `credit_card`, `debit_card`, `apple_pay` and `google_pay`
alike. Reading it (not assuming) shows Apple Pay and Google Pay are **not**
two separate implementations today: both send the identical request shape
— `payment_method.card.encrypted = cardToken` — and differ **only** in the
`payment_method.type` string (`"APPLE_PAY"` vs `"GOOGLE_PAY"`,
`PAGBANK_PAYMENT_METHOD_TYPE` in `charge.ts`). The legacy checkout route
confirms this: both `pagbank_apple_pay` and `pagbank_google_pay` map to the
same `createPagBankCardCharge` call, differing only in the `paymentMethod`
argument (`app/api/checkout/payment/route.ts`).

```
APPLE_PAY_EXISTING_CAPABILITY = YES (via the shared createCardCharge path)
GOOGLE_PAY_EXISTING_CAPABILITY = YES (via the same shared path)
```

Nothing was invented to make this true — this is the capability as it
exists today, verified independently for each wallet as instructed (Section
9), and the answer for both happens to be "the same code path." The native
adapter mirrors this reality: one shared `createNativePagBankWalletPayment`,
with two named, independently-testable entry points
(`createNativePagBankApplePayPayment`/`createNativePagBankGooglePayPayment`)
for clarity — not two divergent implementations invented where none exist.

## 2. PROVIDER_LOGIC vs WOO_ANCHORING vs CHECKOUT_UI_CONCERNS

| File / concern | Classification | Reused as-is? |
|---|---|---|
| `services/payments/pagbank/client.ts` (`pagbankRequest`, Bearer token, timeout/error handling) | PROVIDER_LOGIC | Yes, unchanged |
| `services/payments/pagbank/charge.ts` (`createCardCharge`, `getCardChargeStatus`) | PROVIDER_LOGIC | Yes, unchanged, called directly |
| `services/payments/pagbank/errors.ts` (`PagBankPaymentError`) | PROVIDER_LOGIC | Yes, unchanged |
| Wallet tokenization (Apple Pay JS / Google Pay API issuing `cardToken` client-side) | CHECKOUT_UI_CONCERN | Not touched, already token-only |
| `app/api/checkout/payment/route.ts`: `referenceId: String(order.id)` | WOO_ANCHORING | Not reused — native path uses the native `orderId` (UUID) |
| `services/woocommerce/orders.ts` (`createPendingOrder`, `attachPaymentReference`, `markOrderAsPaid`, `markOrderAsFailed`) | WOO_ANCHORING | Not called |
| `services/payments/reconcile.ts`: `categorizeCardStatus` | Pure PROVIDER_LOGIC re-derived (Section 5); `reconcilePaymentReference` is WOO_ANCHORING | Categorization re-derived for the ledger's vocabulary |
| `app/api/webhooks/pagbank/route.ts` | WOO_ANCHORING (calls `reconcilePaymentReference`) | Not modified; "id-only from the body, always re-query" principle carried over |

## 3. Wallet security boundary (Section 6)

`CreateCardChargeInput.cardToken` has never accepted a raw PAN/CVV or an
unencrypted wallet cryptogram — tokenization already happens client-side
(Apple Pay JS / Google Pay API) before any backend code runs, for both
wallets identically (Section 1). `nativeAdapter.ts` passes `cardToken`
straight through to `createCardCharge` and never reads it back, logs it, or
persists it. `payment_attempts`/`payment_events` have no column for it;
only `chargeId`, `brand`, `lastDigits` and `installments` are used —
exactly what the legacy `attachPaymentReference` already persists.
`PAGBANK_WALLET_TOKEN_PERSISTED = NO`.

## 4. Provider idempotency — a real, load-bearing finding (Section 10)

Reading `services/payments/pagbank/client.ts`'s `pagbankRequest`: it sends
**no** idempotency header of any kind, and `createCardCharge` accepts **no**
idempotency parameter at all — unlike Mercado Pago's `client.ts`, which
already sends `X-Idempotency-Key`. `PAGBANK_PROVIDER_IDEMPOTENCY_SUPPORTED
= NO`. Per Section 10's own instruction ("se não suportado ou não
comprovado: não presumir retry seguro"), this adapter uses the **same
conservative strategy as Inter's Boleto adapter**, not Mercado Pago's:

- A claim gate (`created -> pending`, no reference, before any provider
  call) protects against **true concurrency** — proven under real Postgres
  concurrency (`duplicateApplePayCreateOneLogicalAttempt`,
  `duplicateGooglePayCreateOneLogicalAttempt`).
- A **sequential retry** from `pending` with no `provider_reference` (the
  signature of an ambiguous timeout) is refused outright —
  `NativePagBankWalletAmbiguousRetryError` — because there is no
  provider-side backstop to fall back on, unlike Mercado Pago. Resolving
  that state requires an out-of-band step that does not exist yet.

This is a materially different decision from Mercado Pago's adapter for a
materially different reason (a verified absence of idempotency support, not
a stylistic choice), documented explicitly per Section 10/12.

## 5. Status normalization (Section 13)

| PagBank status (from `charge.ts`'s own validated union) | Ledger status |
|---|---|
| `PAID` | `paid` |
| `AUTHORIZED` | `authorized` |
| `IN_ANALYSIS` | `pending` |
| `DECLINED` | `failed` |
| `CANCELED` | `cancelled` |

No new ledger state invented. `status_detail` equivalent: PagBank's
`CardChargeResult` exposes no such field at all in the existing
integration — nothing to extract, nothing misused as canonical state.

## 6. Chargeback / dispute (Section 20)

Audited explicitly, as required. `charge.ts`'s `CardChargeStatus` union is
`AUTHORIZED | PAID | DECLINED | IN_ANALYSIS | CANCELED` — **no**
`REFUNDED`/`CHARGED_BACK`/dispute-equivalent value is recognized at all,
unlike Mercado Pago (which does recognize `refunded`/`charged_back` as
status values, even with no code path to *initiate* either — see
[76, Section 9](76-native-mercadopago-gateway-reanchoring.md#9-refundcancellation-capability-section-16)).
Consequence: if PagBank's real API ever reports one of these (or an
equivalent dispute status) in a `charges/{id}` response, the existing,
unmodified `assertChargeStatus` would **throw** `PAGBANK_UNKNOWN_STATUS`
rather than silently misclassify it as paid or failed — a fail-closed
behavior already present in the legacy code, not something this round
added. `PAGBANK_CHARGEBACK_OR_DISPUTE_CAPABILITY = NOT_IMPLEMENTED_IN_EXISTING_INTEGRATION`.

This reinforces, with a second independent data point, the observation
first made in the Mercado Pago round: the payment ledger currently has no
canonical concept for an involuntary, bank/scheme-initiated reversal after
a successful payment, distinct from a merchant-initiated refund. Not
resolved here (Section 24 forbids any ledger migration this round) — logged
as a real signal that the eventual `SHARED_PAYMENT_ORDER_INVENTORY_ORCHESTRATION`
phase, or a dedicated follow-up, should consider a canonical
chargeback/dispute event type when it revisits the ledger schema.

## 7. Order boundary (Section 18) and shared inventory blocker (Section 19)

Order boundary: same mapping as Inter/Mercado Pago — `paid` →
`transition_native_order(pending -> confirmed)`; terminal failure → `pending
-> cancelled`. No new state invented; not wired.

Inventory boundary: reuses, unchanged, the exact blocker documented in
[75, Section 7](75-native-inter-gateway-reanchoring.md#7-order-boundary-section-13-and-inventory-boundary-section-14--qualified-not-wired)
and reaffirmed in [76, Section 10](76-native-mercadopago-gateway-reanchoring.md#10-inventory-boundary-section-18).
No PagBank-specific workaround was created; no grant, `SECURITY
DEFINER`/`INVOKER` change, or new entrypoint was made.
`PAGBANK_INVENTORY_BOUNDARY = BLOCKED_BY_SHARED_PAYMENT_ORCHESTRATION`. Per
Section 19, this does not fail the wallet adapters themselves.

## 8. Legacy regression (Section 23)

`git status` on every legacy PagBank/Woo file shows zero changes. Existing
tests pass unchanged (`tests/paymentsReconcile.test.mjs`,
`tests/paymentsWooOrders.test.mjs`, `tests/checkoutPaymentConfirmation.test.mjs`,
etc.). `PAGBANK_LEGACY_PATH_PRESERVED = YES`.

## 9. Refund / cancellation capability (Section 17)

`services/payments/pagbank/charge.ts` has **no** refund or cancellation
function of any kind — confirmed by direct search, not inferred.
`PAGBANK_REFUND_CAPABILITY = NOT_IMPLEMENTED_IN_EXISTING_INTEGRATION`,
`PAGBANK_CANCEL_CAPABILITY = NOT_IMPLEMENTED_IN_EXISTING_INTEGRATION`.
Concurrency property G (duplicate refund) explicitly skipped in the
harness for the same reason — not invented.

## 10. Inter / Mercado Pago regression (Section 22)

Re-ran, unmodified except for one shared, honest fixture bug found and
fixed (see below):

- `scripts/database/native-inter-payment-concurrency.mjs` — 5/5 properties
  still pass.
- `scripts/database/native-mercadopago-payment-concurrency.mjs` — 6/6
  properties still pass.
- `scripts/database/native-payment-ledger-concurrency.mjs` (Phase 2) — 6/6
  properties still pass.
- pgTAP 666/666 unchanged.
- Full `npm test`: 1397/1398 (only the pre-existing, unrelated
  `tests/instagramFeed.test.mjs` failure remains).

**Shared fixture bug found while re-running the Inter harness a second
time against the persistent local database**: two hardcoded
`provider_reference` literals (`REQ-D`, `TXID-E`, left over from the Inter
round) collided with themselves on a second run, since the local database
is not reset between harness invocations. This is a harness-fixture bug,
not a defect in the adapter or the ledger — fixed by giving both literals a
per-run random suffix, matching the pattern already used everywhere else in
every harness in this family (including this round's own PagBank harness,
written with unique-per-run references from the start). No adapter or
migration code was touched to fix this.

`INTER_NATIVE_REGRESSION_PASS = YES`, `MERCADO_PAGO_NATIVE_REGRESSION_PASS
= YES`.

## 11. Testing

- `tests/paymentsPagBankNativeAdapter.test.mjs` — 12 unit tests: status/
  error normalization, Apple Pay creation (claim-before-provider, no Woo id),
  Google Pay creation (proving the shared code path with only the method
  argument differing), claim-race-lost, ambiguous-retry-blocked (the PagBank-specific
  behavior), retry-safe-with-reference, provider-timeout, synchronous-decline-as-failed,
  webhook verification, reconciliation.
- `scripts/database/native-pagbank-payment-concurrency.mjs` — 6 properties
  (A–F) against real local Postgres, no provider called; G (duplicate
  refund) explicitly skipped and documented (Section 9).

## 12. What this round does NOT do

- No call to a real PagBank endpoint, sandbox or production.
- No wiring into the checkout flow.
- No inventory-reservation wiring (shared blocker, unchanged).
- No order-status transition wiring (qualified only).
- No refund/cancel/chargeback implementation (no existing capability).
- No feature flag.
- No change to the payment ledger migration or to any legacy PagBank/
  WooCommerce/Inter/Mercado Pago file (only two harness fixture literals in
  the Inter round's own disposable script were touched, for re-runnability).
