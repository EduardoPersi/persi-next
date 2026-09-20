# 84 — Native HTTP Checkout Boundary (ACCELERATED — Track C)

Status: **prepared, not exposed**. `NATIVE_CHECKOUT_RUNTIME_ENABLED` stays
`NO`. The route exists in code but returns 404 for every request, always,
this round — `isNativeCheckoutRuntimeEnabled()`
(`lib/runtime/native-checkout-mode.ts`) is hardcoded `false` and this round
does not change that.

## 1. Why this exists

[79-native-checkout-payment-wiring.md](79-native-checkout-payment-wiring.md)
built `submitNativeCommerceCheckout` (`services/checkout/nativeCheckoutService.ts`)
fully wired end-to-end and concurrency-proven, but explicitly noted (§13):
*"No route exists, so 'browser cannot call the orchestration directly' is
true by the simple absence of any HTTP entrypoint."* This was the last
missing piece between a qualified service and something an eventual browser
could call — `NATIVE_HTTP_CHECKOUT_BOUNDARY_READY` was effectively blocked on
it not existing at all.

## 2. What was built

[`app/api/checkout/native/route.ts`](../../app/api/checkout/native/route.ts) —
a single `POST` Route Handler, following the same conventions as the existing
[`app/api/checkout/payment/route.ts`](../../app/api/checkout/payment/route.ts)
(Zod `.strict()` validation, `runtime="nodejs"`, `dynamic="force-dynamic"`,
`revalidate=0`, the same `exceedsRequestLimit` request-size guard, typed
error → status mapping). It is a thin wrapper: every line of price/shipping/
inventory/payment-state-machine logic still lives in
`submitNativeCommerceCheckout` and the primitives it calls — nothing was
duplicated here.

### 2.1 What the request accepts (and deliberately does not)

The request body accepts exactly four things: `checkoutId`, `expectedVersion`
(a decimal-string-encoded `bigint`, for optimistic concurrency — never
authority), `idempotencyKey`, a bearer `guestToken`, and a `payment` object
scoped per method to *only* the fields that could ever be genuinely known
client-side (an SDK-issued single-use card/wallet token, `installments`,
`paymentMethodId`, `issuerId`).

It does **not** accept: amount, currency, shipping cost, payment status,
order status, provider reference, contact name/email/phone, billing/shipping
address, or a tax document. Amount/currency/order-status/payment-status/
provider-reference were never inputs to `submitNativeCommerceCheckout` in the
first place (the service derives them from the just-created native order and
its own ledger) — the route adds no new path for a browser to smuggle any of
those in. Contact/address/tax-document going further than the spec's stated
minimum: the route derives them server-side by decrypting the checkout's own
already-persisted, already-fingerprinted PII
(`decryptNativeCheckoutPii`, `lib/db/nativeCheckoutPii.ts` — extended this
round, see §4) rather than trusting a fresh copy resubmitted in this request.
This removes an entire class of "the address the browser sends at payment
time doesn't match what was fingerprinted earlier" mismatch, at zero extra
cost, since the PII was going to be read anyway to compute
`expectedPiiFingerprint`/`expectedDestinationFingerprint`.

### 2.2 Owner resolution — guest-token-only this round

Every existing native-checkout script/test in this codebase
(`native-checkout-payment-e2e.mjs`, `native-checkout-payment-concurrency.mjs`)
already always passes `customerId: null`. No resolver from an authenticated
WooCommerce/account session (`getServerAccountSession()`) to a native
`customers` table row exists anywhere in `lib/db` — inventing one here would
be exactly the kind of unrequested schema/business-logic addition this
project's rules warn against (Section 27.1: "não criar abstração genérica sem
usos reais"). This route therefore only supports guest checkout, matching the
established convention, not a design regression. **This is a real,
open gap** — tracked as a staging blocker in
[86-staging-readiness-package.md](86-staging-readiness-package.md) — not
something silently worked around.

The `guestToken` itself carries the same trust model as the WooCommerce
cart's own `CART_TOKEN_COOKIE`: a high-entropy bearer secret, checked via
`hashGuestCartToken` (unchanged). It is accepted from the JSON body rather
than a dedicated `httpOnly` cookie only because no native-checkout cookie/
session infrastructure exists yet to issue one from — a future round that
wires the earlier checkout steps (cart creation, PII persistence, "ready")
to HTTP should move it there.

### 2.3 `taxId` is never populated

`encryptDurableTaxDocument`'s AAD (`lib/commerce/taxDocumentCrypto.ts`) binds
to a specific `orderId`, but `submitNativeCommerceCheckout` generates the
order's id internally (`randomUUID()`, ignored on an idempotent replay) and
never accepts one from its caller — there is no way to encrypt a tax
document bound to the correct `orderId` *before* that order exists. No prior
round's script or test populates `taxId` either. Solving this (a two-phase
encrypt-after-create step, or an AAD that doesn't bind to `orderId`) is a
real, separate design decision, not invented here — `taxId: null` on every
submission this round.

### 2.4 No route-level idempotency bookkeeping

Unlike the legacy route's `reserveCheckoutAttempt`/`transitionCheckoutAttempt`
machinery (needed because the legacy WooCommerce path is not atomic at the
database level), the native path already has idempotency built into
`submit_native_checkout` (`checkoutId`+`idempotencyKey`) and
`create_native_payment_attempt` (`provider`+`idempotencyKey`) themselves —
proven under real 20-way concurrency by
`scripts/database/native-checkout-payment-concurrency.mjs` (Phase 3A). A
retried identical request converges on the same order/attempt by
construction; this route adds nothing on top (C10).

### 2.5 Error mapping applies Track B's own finding

`safePostgresMessage` checks `error.cause` before `error.message` — the
exact defect [81-drizzle-datetime-error-cause-audit.md](81-drizzle-datetime-error-cause-audit.md)
found and fixed in the three gateway adapters this round. Without it, every
business-error code raised by a SQL function through drizzle
(`CHECKOUT_NOT_FOUND`, `stale_checkout_version`, etc.) would silently fall
through to a generic 502 instead of its correct status/category.

## 3. Small extension to `decryptNativeCheckoutPii`

`lib/db/nativeCheckoutPii.ts`'s `decryptNativeCheckoutPii` previously
returned only the decrypted `CanonicalCheckoutPIIEnvelope`, discarding the
`pii_fingerprint`/`pii_destination_fingerprint` columns it had already
selected. This route is that function's first real caller and needs exactly
those two values (to pass through to `submit_native_checkout`'s
`expectedPiiFingerprint`/`expectedDestinationFingerprint` unchanged, without
recomputing them) — the return type is now
`{ envelope, fingerprint, destinationFingerprint }`. No new query, no new
column, no behavior change to decryption itself.

## 4. Security checklist (Section 27 of the spec)

| Property | How it's met |
|---|---|
| No authoritative price from browser | Not an input to the route or the service. |
| No authoritative shipping amount | Same. |
| No authoritative payment status | Same — `paymentStatus` in the response comes from the ledger, never round-trips as an input. |
| No authoritative order status | Same. |
| No authoritative provider reference | Same. |
| Ephemeral card/wallet tokens never logged | The single `console.error` call logs only `{status, code, method, checkoutId}` — no `payment` object, no token. |
| Safe error mapping | Generic Portuguese messages for 5xx/502; category-specific but still generic messages for 4xx business states; no raw Postgres/error text ever reaches the response body. |
| Safe response DTO | The response body is exactly `submitNativeCommerceCheckout`'s own `NativeCheckoutPresentationResult` — no PII, no ciphertext, no raw DB row. |
| Correlation identifier safe for logs | `checkoutId` only (a UUID, not PII). |
| Rate limiting | Not added this round — `assertPaymentsAllowed` (existing `lib/runtime/external-write-guard.ts` policy gate) is called before any provider-facing path would run, as defense-in-depth alongside the runtime flag; a dedicated rate limiter is a Track H staging task if load-testing shows it's needed, not invented speculatively here. |

## 5. Tests (C1–C10)

[`tests/nativeCheckoutHttpBoundary.test.mjs`](../../tests/nativeCheckoutHttpBoundary.test.mjs).
Importing the route file directly and calling `POST(new Request(...))` is
not possible under the plain Node test runner used by `npm test` — `next/server`'s
package export map isn't resolvable by Node's ESM loader outside Next's own
bundler (`ERR_MODULE_NOT_FOUND: next/server`), the same reason
`tests/checkoutPaymentHealth.test.mjs` (for the legacy route) uses static
source-text assertions instead of a live call. This file follows the same,
already-established convention: every one of C1–C10 is pinned to a specific,
named code pattern in the route source (schema shape, field absence, log
statement contents, response construction), not merely described. All 8
tests pass. `NATIVE_HTTP_CHECKOUT_RUNTIME_EXPOSED = NO` (confirmed by the
C7 test, which also re-checks the flag file itself).

## 6. What this round does NOT do

- Does not build the earlier checkout steps (cart creation, PII persistence,
  "ready") as HTTP routes — those remain script/test-only, same as before
  this round. This route's inputs (`checkoutId`, `expectedVersion`, a
  persisted PII envelope) assume that flow already happened through some
  channel.
- Does not resolve authenticated native-customer identity.
- Does not solve tax-document encryption timing.
- Does not add a dedicated rate limiter.
- Does not enable `NATIVE_CHECKOUT_MODE` or flip
  `isNativeCheckoutRuntimeEnabled()` to ever return `true`.
