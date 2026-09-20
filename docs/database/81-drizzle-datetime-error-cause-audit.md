# 81 — Drizzle Date/Time + `error.cause` Audit (ACCELERATED — Track B)

Status: **audit complete, 2 confirmed defects fixed**. Scope: `lib/db/*`,
`services/checkout/*`, `services/payments/*` (including Track A's own new
code). Focused audit, not a general refactor — only confirmed `REAL_BUG`
items were touched.

## 1. Why this exists

[79-native-checkout-payment-wiring.md](79-native-checkout-payment-wiring.md)
Section 2 documented two real bugs found by inspection in this round's own
new code (`persistNativeCheckoutPii`'s `Date` coercion; the three adapters'
`isStalePaymentAttemptTransition` reading `error.message` instead of
`error.cause`), and its Section 15 explicitly flagged that **no systemic
audit of every other `getDatabase().execute()` call site for the same class
of defect** had been performed — a documented `POST_V1` gap, not a closed
one. This round closes it.

## 2. The underlying defect class

`getDatabase().execute<T>()` (drizzle-orm's postgres-js raw-execute path,
`lib/db/connection.ts`) returns `timestamptz` columns as **strings**, never
`Date` instances, regardless of the generic type parameter passed to
`.execute<T>()` — that generic is a compile-time assertion only, never a
runtime coercion. Any function that types a query result field as `Date` and
then calls a `Date` method on it (`.getTime()`, `.toISOString()`,
arithmetic) without an explicit `new Date(...)` coercion will throw a
`TypeError` the first time real data flows through it. Because several of
these functions are dormant (qualified in isolation, not yet called from any
route), the defect is silent until a future caller exercises the path — the
exact way `persistNativeCheckoutPii`'s own bug was found.

Separately: `drizzle-orm`'s `DrizzleQueryError.message` is always the
generic `"Failed query: ..."` string; the real Postgres error (with its
actual `errcode`/message text) is nested in `.cause`. Code that pattern-
matches a caught error's `.message` for a specific Postgres error text will
never match when the call went through drizzle (as opposed to the raw
`postgres` client the `scripts/database/*.mjs` harnesses use, which throws
the real error directly) — exactly [79]'s already-documented, already-fixed
defect in the three adapters' `isStalePaymentAttemptTransition`.

## 3. Method

Grepped `lib/db/*`, `services/checkout/*`, `services/payments/*` for:
`new Date(`, `.getTime()`, `.toISOString()`, `instanceof Date`,
`Date.parse(`, `: Date` type annotations, and `catch (error)` blocks that
inspect `error.message`/`error.cause`. Every hit was traced to its actual
data source (caller-supplied `Date` input vs. `.execute()` query output vs.
provider-API JSON) and classified.

## 4. Classification

| Site | Classification | Notes |
|---|---|---|
| `lib/db/inventory.ts` `ReserveInventoryInput.expiresAt` | SAFE | Input parameter, real `Date` from caller, `.toISOString()`'d before the query. |
| `lib/db/nativeCart.ts` `createNativeCart`'s `expiresAt` | SAFE | Same — input, not output. |
| `lib/db/nativeCheckout.ts` `NativeCheckoutQuoteInput`/`PrepareNativeCheckoutInput.expiresAt` | SAFE | Input parameters. |
| `lib/db/nativeCheckout.ts` `canonicalValue`'s `instanceof Date` branch | SAFE | Generic hashing helper; only ever receives real `Date`s from caller-constructed intent objects, never a raw query row. |
| `lib/db/nativeCheckout.ts` `NativeCheckoutReadModel.expiresAt` (`readNativeCheckout`) | **NEEDS_FOLLOWUP** | Query-output field typed `Date`, actually a string at runtime. Currently has exactly one real caller (`scripts/database/native-checkout-payment-e2e.mjs`) and it never calls a `Date` method on this field — not exploitable today. Type annotation is misleading; left as-is (no behavioral change) to keep this round's diff to confirmed bugs, flagged here for whoever adds the first real consumer. |
| `lib/db/nativeCheckoutPii.ts` `persistNativeCheckoutPii`'s `checkout.expiresAt` | SAFE (already fixed pre-round) | Explicitly coerced via `new Date(checkout.expiresAt)` — [79]'s own documented fix, verified still in place. |
| `lib/db/nativeCheckoutPii.ts` `decryptNativeCheckoutPii`'s `row.piiExpiresAt` | **REAL_BUG — FIXED** | Passed the raw string straight into `decryptCheckoutPii({ expiresAt })`, which calls `.getTime()` on it (`lib/commerce/checkoutPii.ts:220`) — guaranteed `TypeError` the first time this function (zero callers before this audit) is ever exercised. Fixed by wrapping in `new Date(...)` at the call site, same idiom as the already-fixed sibling function. |
| `lib/db/nativePriceAuthority.ts` `resolveStorePriceAuthority`/`readCheckoutPriceAuthority`'s `validFrom`/`validTo` | **REAL_BUG — FIXED** | Query-output fields typed `Date`, actually strings. `createAuthorityPriceFingerprint` (the matching-named, evidently-intended downstream consumer) calls `.toISOString()` on `priceValidFrom`/`priceValidTo` — same guaranteed crash on first real use (this module has zero callers anywhere in the codebase yet; `PRICE_AUTHORITY_WIRING_PASS=YES` from the Phase 3A baseline refers to the SQL-level `resolve_store_price_authority` function being called *from inside* `prepare_native_checkout`, not to this TypeScript wrapper having any caller). Fixed with a shared `toStorePriceAuthoritySnapshot` coercion applied to both functions' return values. |
| `lib/db/nativeOrder.ts` timestamp fields | SAFE | Only ever embedded via `jsonb_agg(to_jsonb(...))` — already-serialized JSON, never extracted as a typed `Date` column. |
| `services/payments/inter/{pix,boleto}.ts` Date arithmetic | SAFE | Provider-API JSON strings (Banco Inter's own response bodies), consistently wrapped in `new Date(...)` before any `Date` method — not drizzle output. |
| `services/checkout/nativeCheckoutService.ts` | SAFE | No `Date` methods called anywhere in this file; presentation DTOs pass expiry-shaped fields straight through as opaque strings. |
| `lib/commerce/checkoutAttempt.ts` | SAFE | No `catch` blocks, no `Date` methods. |
| `services/payments/{inter,mercadopago,pagbank}/nativeAdapter.ts` `isStalePaymentAttemptTransition` | SAFE (already fixed pre-round) | All three check both `error.message` and `error.cause` against the same regex — [79]'s documented fix, re-verified present in all three files, not just the one this document originally traced it in. |
| `lib/db/*` — any other `catch (error)` block | SAFE (none found) | `lib/db/*` has no `catch` blocks at all; every wrapper lets a Postgres error propagate uncaught to its caller. The `error.cause` risk is therefore fully confined to the three adapters above, already covered. |

**Totals**: 24 distinct risky sites inspected (14 `: Date`-annotated
fields/parameters, 4 provider-side Date-arithmetic sites, 3 `error.cause`
sites re-verified, 3 `.execute()` call sites cross-checked for hidden
`catch` blocks). **2 confirmed `REAL_BUG`, both fixed. 1 `NEEDS_FOLLOWUP`
(type-accuracy only, not currently reachable). 0 additional `error.cause`
defects** — the three adapters' fix from [79] was the only instance of that
pattern anywhere in native-commerce code, and it is intact.

## 5. Fixes applied

- `lib/db/nativeCheckoutPii.ts`: `decryptNativeCheckoutPii` now wraps
  `row.piiExpiresAt` in `new Date(...)` before calling `decryptCheckoutPii`.
- `lib/db/nativePriceAuthority.ts`: new private
  `toStorePriceAuthoritySnapshot` helper coerces `validFrom`/`validTo` to
  real `Date` instances (or `null`); applied to both `resolveStorePriceAuthority`
  and `readCheckoutPriceAuthority`'s return values.

No historical/frozen migration, SQL function, or unrelated file was touched.

## 6. Regression proof

[`scripts/database/native-drizzle-datetime-audit-regression.mjs`](../../scripts/database/native-drizzle-datetime-audit-regression.mjs)
(real local Postgres): both fixes proven end-to-end —
`resolveStorePriceAuthority` returns real `Date` instances for both a `null`
and a non-`null` `validTo`, `createAuthorityPriceFingerprint` fed directly
from that output never throws, and a real `persistNativeCheckoutPii` →
`decryptNativeCheckoutPii` round trip succeeds and returns the original PII.
All properties `true`; `ALL_PASS: true`.

`npx tsc --noEmit` and `npx eslint` clean on every changed file. `npm test`:
1403/1404 passing — the one failure
(`tests/instagramFeed.test.mjs`) is a pre-existing, unrelated regression
(an already-landed `InstagramCarouselLazy` refactor the test's own assertion
hasn't been updated for) present before this round started, not touched by
it, and not native-commerce-related; reported here rather than hidden, per
this round's own instructions.
