# 79 — Native Checkout → Payment Wiring (B.3-I)

Status: **qualified locally, not live**. No route calls this round's new
service; `NATIVE_CHECKOUT_RUNTIME_ENABLED` stays `NO` regardless of what
passes here. New files:
[`services/checkout/nativeCheckoutService.ts`](../../services/checkout/nativeCheckoutService.ts),
[`lib/runtime/native-checkout-mode.ts`](../../lib/runtime/native-checkout-mode.ts),
[`scripts/database/native-checkout-payment-e2e.mjs`](../../scripts/database/native-checkout-payment-e2e.mjs),
[`scripts/database/native-checkout-payment-concurrency.mjs`](../../scripts/database/native-checkout-payment-concurrency.mjs),
[`tests/nativeCheckoutService.test.mjs`](../../tests/nativeCheckoutService.test.mjs).
Modified: `lib/db/nativeCart.ts`, `lib/db/nativeCheckout.ts`,
`lib/db/nativeCheckoutPii.ts` (new wrappers + real bug fixes, Section 5),
and all three gateway adapters (one shared bug fix, Section 6). No new
migration; the payment ledger and shared-orchestration migrations are
untouched and verified byte-identical to their prior-round state.

## 1. Architecture mapping (Sections 4–5)

**Legacy checkout** (untouched, still official): `app/api/checkout/payment/route.ts`
creates a WooCommerce order via `createPendingOrder`, then routes to
`interPaymentGateway`/`createMercadoPagoCardCharge`/`createPagBankCardCharge`
directly. Nothing here was read further than in prior rounds' own mapping.

**Native foundation, before this round**: schema-complete since B.3-C, but
its TypeScript wrapper layer was **partial** — `lib/db/nativeCheckout.ts`
wrapped session prepare/ready/close but not `submit_native_checkout` itself;
`lib/db/nativeCart.ts` had only guest-token helpers, no cart CRUD; nothing
wrapped `canonical_native_submission_request_hash`. The only prior
functional exercise of the full cart→checkout→submit sequence was raw SQL
in `scripts/database/native-checkout-e2-concurrency.mjs` — the exact
calling convention (argument order, owner-fingerprint hashing, hash-before-
submit) this round's new wrappers replicate rather than invent.

**This round's native checkout service** picks up from an already-`ready`
checkout session (produced by the existing `prepareNativeCheckout` →
`persistNativeCheckoutPii` → `markNativeCheckoutReady` sequence, all reused
unchanged) and owns exactly the submission→payment boundary:
`submitNativeCheckout` → native order → `payment_attempt` → gateway adapter
→ presentation DTO.

## 2. Real defects found and fixed (Section 5's "thin wiring" surfaced them)

None of the following had ever been exercised against a live database or
under real concurrency before this round — they were undetectable by
structural (regex-on-file-text) tests, the only kind that previously
touched this code.

1. **`persistNativeCheckoutPii` crashed on its very first real call.**
   `getDatabase().execute()` (drizzle-orm's raw-execute path over
   `postgres-js`) returns `timestamptz` columns as **strings**, not `Date`
   instances, regardless of the TypeScript generic passed to
   `.execute<T>()` — that generic is a compile-time assertion only, never a
   runtime coercion. The function called `.getTime()` directly on the
   result. Fixed by coercing with `new Date(...)` first. This is a
   **systemic drizzle-orm behavior**, not specific to this one call site —
   flagged in Section 9 as worth a dedicated, separate audit of every other
   raw `.execute()` call site in `lib/db/` that might assume a real `Date`.
2. **`persistNativeCheckoutPii` computed `fingerprint`/`destinationFingerprint`
   internally but never returned them**, even though every real caller
   needs both immediately afterward (`markNativeCheckoutReady`'s
   `expectedPiiFingerprint`, `submitNativeCheckout`'s two fingerprint
   params). Fixed by adding both fields to the return value — pure
   addition, no existing behavior changed.
3. **This round's own `computeNativeCheckoutSubmissionHash`** used
   `select * from public.canonical_native_submission_request_hash(...)`
   for a function that returns a scalar `text`, not a table — Postgres
   names that column after the function itself, not `request_hash`. Fixed
   by aliasing explicitly. A bug in new code, caught immediately by the E2E
   script.
4. **The claim-gate race-loss handling in all three gateway adapters
   (Inter, Mercado Pago, PagBank) never actually caught a real race loss
   when reached through the production database wrapper.** `isStalePaymentAttemptTransition`
   checked `error.message`, matching the exact string
   `scripts/database/native-payment-ledger-concurrency.mjs` and its
   siblings use — but those harnesses all call the SQL functions **directly**
   via the raw `postgres` package. Every real adapter call site goes through
   `lib/db/nativePayment.ts` (drizzle-orm), where a failed query throws a
   `DrizzleQueryError` whose own `.message` is always the generic `"Failed
   query: ..."` text (see `drizzle-orm/errors.js`) — the real Postgres
   error, with the actual `stale_payment_attempt_transition` message, is
   nested in `.cause`. This means every claim-gate race loser, reached
   through the real production path, would previously have propagated as
   an **unhandled rejection** instead of returning quietly — a real,
   latent concurrency-safety gap in code delivered and "proven" across
   three separate prior rounds (B.3-E/F/G), never caught because none of
   those rounds' own harnesses exercised the drizzle-wrapped path under
   real concurrency. Fixed identically in all three adapters: also check
   `error.cause`. Confirmed fixed by `scripts/database/native-checkout-payment-concurrency.mjs`,
   which failed with exactly this symptom before the fix and passed
   cleanly after, for all three providers.

## 3. `submitNativeCommerceCheckout` — the thin orchestrator

```
submitNativeCommerceCheckout(input, providerMocks?) -> NativeCheckoutPresentationResult
```

Six steps, each delegating to an already-tested authority:

1. Fail-closed routing (`assertKnownPaymentMethod` — Section 7) before any
   database write.
2. `submitNativeCheckout` (this round's new wrapper) — creates the native
   order + inventory reservations atomically. **Always before any provider
   call** (Section 15) — there is no code path in this file that talks to
   a provider before a persistent, reconcilable native order exists.
3. `readNativeOrder` — the order's own `grandTotalMinor`/`currency` become
   the **sole** authority for the payment amount (Section 8); nothing from
   `input` is ever used for money.
4. Dispatch to the correct adapter (`createNativeInterPixPayment` /
   `createNativeInterBoletoPayment` / `createNativeMercadoPagoCardPayment` /
   `createNativePagBankWalletPayment`), reusing the checkout's own
   idempotency key as the payment attempt's idempotency key.
5. The adapter's own claim-gate, provider call, and event-application logic
   run unchanged (Section 2: no price/shipping/inventory/payment-state-
   machine logic duplicated here).
6. A provider-shaped presentation DTO is built from the adapter's result
   (Section 21).

## 4. Payment method routing (Section 7)

`NativeCheckoutPaymentMethod = "inter_pix" | "inter_boleto" |
"mercadopago_card" | "pagbank_apple_pay" | "pagbank_google_pay"` — a fixed,
typed union. `assertKnownPaymentMethod` throws `NativeCheckoutError`
(`UNKNOWN_PAYMENT_METHOD`) for anything else, **before** `submitNativeCheckout`
is even called — proven directly (unit test: no order, no payment attempt,
no provider call for an unrecognized method).

## 5. Server-only boundary (Section 8)

Everything privileged happens server-side, inside this one module
(`import "server-only"`). The browser-shaped input
(`SubmitNativeCommerceCheckoutInput`) carries only: checkout identity,
contact/address, and a method-specific **ephemeral credential** (card/wallet
token, payer document/name — never a raw PAN/CVV, since tokenization is a
CHECKOUT_UI_CONCERN already handled client-side before this input exists).
It carries no total, no shipping price, no order/payment status, no
provider reference, no inventory quantity — every one of those is either
derived from the native order (amount/currency) or owned entirely by the
authority being called (`submitNativeCheckout` itself revalidates
price/shipping/inventory; the adapters own payment status/provider
reference). `CHECKOUT_BROWSER_DANGEROUS_PRIVILEGES = 0` — this module has no
knob through which a caller could set any of them directly.

## 6. Card/wallet token handling (Sections 11–12)

`cardToken` is passed straight through to the corresponding adapter's
`createCharge` call and never read back, logged, or stored — verified
directly (unit tests assert the presentation DTO's serialized JSON never
contains the token value for card, Apple Pay, or Google Pay). No new
storage path was added; this round reuses the exact PCI boundary already
established and documented in Inter/Mercado Pago/PagBank's own rounds.

## 7. Idempotency and concurrency (Sections 13, 25)

`scripts/database/native-checkout-payment-concurrency.mjs` fires **20
fully concurrent** identical `submitNativeCommerceCheckout` calls (same
checkout, same idempotency key — the worst case: no client-side re-read of
current state between attempts) for each of the 5 payment methods, against
real local Postgres, with the provider call counted. Results, after the
Section 2 fix:

| Method | Fulfilled | Rejected (recognized-safe) | One order | One attempt | One provider call |
|---|---|---|---|---|---|
| Inter Pix | 20/20 | 0 | yes | yes | yes |
| Inter Boleto | 20/20 | 0 | yes | yes | yes |
| Mercado Pago Card | 20/20 | 0 | yes | yes | yes |
| PagBank Apple Pay | 20/20 | 0 | yes | yes | yes |
| PagBank Google Pay | 18/20 | 2 (`NATIVE_PAGBANK_WALLET_AMBIGUOUS_RETRY_BLOCKED`) | yes | yes | yes |

The two PagBank Google Pay rejections are the **documented, by-design**
ambiguous-retry guard from
[77, Section 4](77-native-pagbank-gateway-reanchoring.md#4-provider-idempotency--a-real-load-bearing-finding-section-10) —
PagBank has no provider-side idempotency, so a caller observing the
attempt already `pending` with no `provider_reference` yet (the narrow
window between a concurrent sibling's claim and its own reference-attach
step) correctly refuses to guess rather than risk a duplicate charge. This
is a safe, expected outcome under real 20-way concurrency, not a defect —
the harness treats it as a recognized rejection class, not a failure.
Every rejection across all five methods and all runs was one of exactly
four recognized, safe classes (`CHECKOUT_VERSION_CONFLICT`,
`stale_payment_attempt_transition`, the PagBank guard above, or — not
observed but structurally possible — `CHECKOUT_IDEMPOTENCY_CONFLICT`);
zero unrecognized/unlabeled errors occurred across 100 total concurrent
calls.

`submitNativeCheckout`'s own idempotency is version-scoped (frozen
migration, by design): a caller retrying with a version that has already
moved (because a concurrent sibling committed first) gets a clean
`CHECKOUT_VERSION_CONFLICT` rather than a silent duplicate. This harness
deliberately does not have callers re-fetch current state between
attempts (the worst case for a naive retry) — Section 13's requirement
("ONE logical order... NO duplicate provider invocation") is satisfied
either way: no code path in `submitNativeCommerceCheckout` reaches an
adapter's provider call except via a payment attempt scoped to the ONE
order that ever gets created for that checkout.

## 8. Failure matrix (Section 14)

| # | Scenario | Mechanism | Verified |
|---|---|---|---|
| A | Price stale | `submit_native_checkout`'s own price-authority revalidation raises `CHECKOUT_PRICE_STALE` before any payment code runs | Unit test (mocked `submitCheckout` throwing) |
| B | Shipping stale | Same function, `CHECKOUT_SHIPPING_QUOTE_INVALID` | Same mechanism, not separately re-tested (identical code path) |
| C | Inventory unavailable | Same function, `CHECKOUT_RESERVATION_*` | Same mechanism |
| D | Order succeeds, payment preparation fails before any provider call | **Recovery = retry the whole `submitNativeCommerceCheckout` call with the same checkoutId+idempotencyKey.** `submitNativeCheckout` and `createNativePaymentAttempt` are both independently idempotent; a retry converges on the same order and the same attempt, never a duplicate. No cross-transaction rollback is attempted or needed (Section 16's own instruction: don't improvise one). | Structurally guaranteed by composition of already-idempotent primitives; exercised implicitly by the concurrency harness (many of its 20 concurrent calls are exactly this scenario racing itself) |
| E | Provider timeout | Each adapter's own, already-qualified timeout handling (Inter: propagates; Mercado Pago: provider-idempotency-trusted retry; PagBank: ambiguous-retry-blocked) applies unchanged | Inherited, not re-tested here |
| F | Provider rejected | Adapter applies the verified rejection through `apply_verified_payment_transition`, converging order/inventory | E2E script (Boleto `EXPIRADO`, PagBank `DECLINED` scenarios both drive `cancelled`/`released`) |
| G | Database failure before payment attempt | Zero provider calls by construction (order-before-provider, Section 15) — nothing provider-facing has run yet | Structural (no code path violates this) |
| H | Database failure after provider uncertainty | Exactly the scenario each adapter's claim-gate / ambiguous-retry design already exists to make reconciliation-safe (Sections 75 §5, 77 §4) | Inherited, not re-solved here |

## 9. Feature flag (Sections 18–20)

`lib/runtime/native-checkout-mode.ts`: `NATIVE_CHECKOUT_MODE = off | shadow
| canary`, fail-closed (default/missing/unknown/wrong-case all resolve to
`off`). Deliberately minimal — no sample rates, no membership rollout
percentages, nothing copied from the PIM shadow/canary model, because
nothing yet calls this service from a route for a richer contract to gate.

**Shadow was evaluated and rejected as unsafe for this specific flow, not
implemented.** `isNativeCheckoutRuntimeEnabled()` always returns `false`,
independent of the env value. Reasoning: shadow observation must never
create a real order, reserve stock, create a payment attempt, or call a
provider (Section 19) — but `submitNativeCommerceCheckout` does all four
*by design*; there is no way to run "a shadow copy of this specific
function" without it being a real, mutating execution. A future
shadow-safe design would need a genuinely read-only simulation (e.g.
re-running only the price/shipping authority checks without submission),
which is a different, smaller function than this round built — not
attempted here per Section 19's own instruction to document rather than
force an unsafe implementation.

**Canary design (Section 20, design only, not implemented)**: membership
should be an explicit, fail-closed allowlist resolved server-side (e.g. a
`native_checkout_canary_members` table or equivalent config keyed by
customer id / store id, never a hardcoded SKU/email/order in source) —
consistent with the project's existing fail-closed patterns
(`runtime-safety-policy.ts`). Not created this round; there is nothing yet
for it to gate.

## 10. Presentation DTO and thank-you contract (Sections 21–22)

`NativeCheckoutPresentationResult` is a discriminated union keyed by
`method`, carrying only: `orderId`, `orderNumber`, `paymentStatus`, and the
minimal per-method presentation fields (Pix: QR/copy-paste/expiry; Boleto:
digitable line/barcode/due date; Card/wallet: brand/last digits/
installments). No provider secrets, no raw provider payload, no internal
DB row shape. This DTO shape **is** the native thank-you-page contract:
`orderId`+`orderNumber`+`paymentStatus` (`pending`/`paid`/`failed`/etc., the
ledger's own vocabulary) is sufficient to represent every state in Section
22's list without querying a Woo order. No page was built or wired this
round — only the contract.

## 11. Webhook and reconciliation internal wiring (Sections 23–24)

Not newly built this round — already exists and is reused unchanged:
`applyNative*WebhookNotification`/`reconcileNative*PendingAttempt`
(Inter/Mercado Pago/PagBank rounds) already implement exactly "provider
webhook → native payment lookup → provider verification → adapter →
`apply_verified_payment_transition`", independent of and parallel to the
legacy Woo webhook endpoints. `scripts/database/native-checkout-payment-e2e.mjs`
proves this end-to-end for Pix (`reconcileNativeInterPendingAttempt`) and
Boleto (`applyNativeInterWebhookNotification`) against a real native order
produced by this round's own checkout service — closing the loop from
checkout submission through to verified-payment convergence.
`NATIVE_WEBHOOK_INTERNAL_WIRING_READY = YES` (qualified, not exposed on any
public endpoint — Section 23 explicitly forbids that this round).
`NATIVE_RECONCILIATION_WIRING_READY = YES` (same reuse, mock-only, no cron).

## 12. Pending reservation recovery (Section 17)

`PENDING_RESERVATION_RECOVERY_READY = NO`. No expiration/reclaim worker
exists for a reservation whose payment preparation never completes (a
customer abandons after order creation but before any payment attempt
reaches a terminal state). `inventory_reservations.expires_at` already
carries the information a future worker would need; nothing currently
reads it proactively. Classified as `BLOCKING_FOR_STAGING`, not blocking
for this round's local wiring (no unattended, long-running process exists
locally that this would protect against).

## 13. Security (Section 27)

No route exists, so "browser cannot call the orchestration directly" is
true by the simple absence of any HTTP entrypoint. Every dangerous
authority (amount, price, shipping, order status, payment status, provider
reference, inventory quantity) is derived server-side from an existing,
already-privilege-checked authority (`submitNativeCheckout`'s own
revalidation; the native order's own totals; the ledger's own state
machine) — none of them are settable through `SubmitNativeCommerceCheckoutInput`.
The underlying grant matrix (`persi_app` can create, `persi_worker` alone
can confirm/transition) is unchanged from Phase 2E and re-verified by the
unchanged 709/709 pgTAP suite. `CHECKOUT_BROWSER_DANGEROUS_PRIVILEGES = 0`.

## 14. Regression

pgTAP 709/709 unchanged (no new migration). All five prior concurrency
harnesses (Phase 2 ledger, Inter, Mercado Pago, PagBank, shared
orchestration) re-run clean, unaffected by the `isStalePaymentAttemptTransition`
fix (they all call the SQL functions directly via the raw `postgres`
package, bypassing drizzle, so they never had this bug to begin with — a
useful cross-check that the fix is additive, not a behavior change to
anything already proven). Full `npm test`: 1403/1404 (the one pre-existing,
unrelated `tests/instagramFeed.test.mjs` failure, predating this entire
engagement). `npx tsc --noEmit` clean.
`PERSI_OFFLINE_VALIDATION=1 npm run build:offline`: `actualExternalRequests
= 0`.

## 15. What this round does NOT do

- No route, no public endpoint, no runtime activation.
- No shadow mode (evaluated, deliberately not built — Section 9).
- No canary implementation (design only).
- No pending-reservation expiration worker.
- No refund/chargeback/partial-refund resolution (unchanged gaps from
  Phase 2C/2D).
- No change to the payment ledger or shared-orchestration migrations, or
  any historical migration.
- No systemic audit of every other `getDatabase().execute()` call site for
  the same string-vs-Date issue found in Section 2 — flagged as a POST_V1
  gap worth a dedicated pass, not performed here (out of this round's
  scope, which is checkout wiring, not a drizzle-orm audit).
