# 88 — Native Commerce DB Execution Identity (STAGING ACCESS & EXECUTION MODEL QUALIFICATION)

Status: **model proven and wired into application code; not activated**.
`SERVER_DB_EXECUTION_MODEL_READY = YES`, `WORKER_DB_EXECUTION_MODEL_READY = YES`.
`NATIVE_CHECKOUT_RUNTIME_ENABLED` stays `NO`, unaffected by this round —
this closes a DB-authority gap, orthogonal to the HTTP-exposure gate.

## 1. Why this exists

[87-staging-readiness-package.md](87-staging-readiness-package.md) §3
flagged: `persi_app`/`persi_worker` are `NOLOGIN` privilege-group roles with
no proven, wired runtime identity — meaning `apply_verified_payment_transition`
and `reclaim_expired_native_reservations` (both `persi_worker`-only) could
not actually be called by anything in a real deployment.

## 2. This was not a fresh design problem

A prior round (referenced as **R4-A/B/C** by the test files that document
it) already designed and rigorously proved the exact mechanism needed, in
three disposable-Docker harnesses
([`scripts/database/runtime-identity-disposable.mjs`](../../scripts/database/runtime-identity-disposable.mjs),
`runtime-identity-pool-stress.mjs`, `runtime-identity-functional-validation.mjs`
— **frozen; not modified by this round**) that were never wired into any
real application code:

- A dedicated `LOGIN NOINHERIT` role per authority
  (`persi_app_login`/`persi_worker_login`), granted membership in the
  matching `NOLOGIN` privilege role with `admin false, inherit false, set
  true` — the login has **zero** ambient privilege of its own and must
  explicitly `SET LOCAL ROLE` inside a transaction to activate it.
- Postgres automatically reverts that activation at `COMMIT` or `ROLLBACK`.
- Cross-role assumption is denied (`42501`); an invalid role name is denied
  (`22023`); pool reuse after a privileged transaction never leaks the
  elevated identity; 200-way concurrent stress showed zero leakage.

**What was actually missing**, confirmed by direct inspection:
1. Those harnesses are stale — `runtime-identity-disposable.mjs` asserts
   exactly 29 migrations; the repo now has 43 — and predate
   `apply_verified_payment_transition`/`reclaim_expired_native_reservations`
   entirely, so neither was ever exercised under real role activation
   (every other script in this engagement runs as the local Postgres
   superuser, which bypasses all grant checks).
2. `grep` across every `.ts` file in the repo, including PIM admin,
   confirmed **zero** application code implemented `SET LOCAL ROLE` or any
   role activation — `lib/db/connection.ts`'s single `getDatabase()` served
   the entire app with one ambient identity.
3. Grants are fine-grained **within a single logical flow**, not per-route:
   inside `submitNativeCommerceCheckout`, `submit_native_checkout` is
   `persi_app`-only while `create_native_payment_attempt`,
   `transition_native_payment_attempt`, and `apply_verified_payment_transition`
   are `persi_worker`-only (the latter two exclusively so) — wiring this
   correctly requires per-call-site role selection.

## 3. What was built

### 3.1 `lib/db/nativeCommerceAuthority.ts` — `withPersiRole`

Two lazily-created connection pools (one per role), each only constructed if
its env var (`NATIVE_APP_DATABASE_URL` / `NATIVE_WORKER_DATABASE_URL`) is
configured. **Fallback by design**: when unconfigured — true in every
environment today, including this repo's own `.env.example` (names added,
no values) and every CI/local flow — `withPersiRole` degrades to
`callback(getDatabase())`, byte-for-byte the pre-existing behavior. This is
the same "prepared but inert by default" idiom as
`lib/runtime/native-checkout-mode.ts`'s `isNativeCheckoutRuntimeEnabled()`.

When configured, it opens a transaction on the matching pool and issues
`SET LOCAL ROLE <role>` (role name from a closed, hardcoded 2-value union —
never interpolated from external input) before invoking the callback,
mirroring `runtime-identity-disposable.mjs`'s own proven statement verbatim.

**Two separate pools/credentials, not one login with both memberships**:
preserves the proven property that `persi_app_login` is structurally
incapable of ever activating `persi_worker` (and vice versa) at the
authentication layer, not merely by which SQL string application code
happens to send.

### 3.2 Wired into every native-commerce DB wrapper, per the confirmed grant map

| Function | Role | Grant source |
|---|---|---|
| `submit_native_checkout`, `prepare_native_checkout`, `mark_native_checkout_ready`, `persist_checkout_pii`, `read_checkout_pii_envelope`, `clear_checkout_pii`, `resolve_store_price_authority`, `canonical_native_submission_request_hash`, `allocate_native_order_number`, `link_inventory_reservation_to_order_item`, SELECT `checkout_sessions`/`orders` | `persi_app` | Confirmed final grant state (later migrations narrowed some of these from an earlier, broader grant — see 3.4) |
| `transition_native_payment_attempt`, `record_native_payment_event`, `transition_native_refund`, `apply_verified_payment_transition`, `reclaim_expired_native_reservations`, `transition_native_order` (dual-granted, kept on worker for locality with `apply_verified_payment_transition`'s own internal call to it) | `persi_worker` | — |
| `create_native_payment_attempt`, `create_native_refund` (dual-granted; run as worker for locality with the worker-only calls immediately adjacent in every real call site) | `persi_worker` | — |

Edited: `lib/db/nativePayment.ts`, `lib/db/nativeCheckout.ts`,
`lib/db/nativeCart.ts`, `lib/db/nativeCheckoutPii.ts`,
`lib/db/nativePriceAuthority.ts`, `lib/db/nativeOrder.ts` — every exported
function that calls a `SECURITY DEFINER`/grant-scoped SQL function or a
grant-scoped table now goes through `withPersiRole`. Behaviorally identical
to before for every current caller, proven in §4.

### 3.3 A genuine, pre-existing grant gap found by this audit

`lib/db/nativePriceAuthority.ts`'s `readCheckoutPriceAuthority` directly
joins `store_price_list_assignments` — a table with
`revoke all ... from public, anon, authenticated, persi_app, persi_worker,
persi_readonly` (`20260903120000_store_price_authority_foundation.sql:150`).
**No application role can read this table directly**; the only sanctioned
path is `resolve_store_price_authority()`, which re-resolves the *current*
authority by `(store, currency, context, asOf)` and has no parameter to
fetch one already-pinned assignment row by id — which is what this function
would need to stop reading the table directly. This function has **zero
real callers anywhere** (confirmed by grep), so it never surfaced before
today (every existing caller runs as the local superuser, bypassing grants).
Not fixed this round — doing so would mean inventing a new `SECURITY
DEFINER` accessor (a schema change), and this round's own rules require
reporting that rather than creating it. **`NEW_MIGRATION_REQUIRED = YES`,
scoped to this one dormant function only** — not to the execution-identity
model, which needs none.

### 3.4 Cart functions were narrowed after their original grant

`create_native_cart`/`add_native_cart_item`/etc. were originally granted to
`persi_app, persi_worker` (`20260902190000_native_cart_foundation.sql`), but
`20260905180000_native_checkout_atomic_submission.sql` later revokes and
re-grants them to `persi_app` only — confirmed both by direct migration
inspection and by `runtime-identity-disposable.mjs`'s own
`WORKER_CREATE_CART`/`WORKER_ADD_ITEM`/etc. assertions, all expecting
`42501`. Wired as `persi_app`-only accordingly.

## 4. Real login-role provisioning: disposable, not committed

**`NEW_MIGRATION_REQUIRED = NO`** for the execution-identity model itself —
the grants already exist correctly; only out-of-band role *provisioning* is
needed, and it must never be a committed migration (a migration containing
`CREATE ROLE ... PASSWORD` would put a secret in git history regardless of
how random the password is).

[`scripts/database/native-execution-identity-qualification-disposable.mjs`](../../scripts/database/native-execution-identity-qualification-disposable.mjs)
re-proves the full property matrix specifically for this engagement's own
functions, with random, freshly-generated passwords, never printed.

**Deviation from R4-A's disposable-Docker-container approach, documented in
the script itself**: attempting a fresh bare-image container (matching
R4-A's exact method) hit a reproducible, unrelated environmental obstacle —
`20260903130000_public_browser_privilege_remediation.sql` expects a
function `public.rls_auto_enable()` ("internal ensure_rls event-trigger
function") that is not defined anywhere in this project's own migrations
and never appeared within a 90-second readiness window on a bare-image
container in this environment; it is evidently provisioned by the Supabase
CLI's own platform bootstrap (`supabase start`), not by the base image or
this project's migrations alone. Since the actual local Supabase instance
this engagement has used throughout (started via `supabase start`, reset
via `supabase db reset --local`) already has that platform bootstrap and
has been reliable all along, this script targets that running instance
instead — creating its two login roles with random passwords, running the
full matrix, and reversing every grant plus dropping both roles in a
`finally` block, leaving the database exactly as found. This changes
*where* the roles are created, not *what* is proven or *how* — the `SET
LOCAL ROLE` mechanism and every assertion are unchanged from R4-A's own
design. (Also discovered along the way: `DROP OWNED BY` failed with
"permission denied to drop objects" against this Supabase-managed
instance's `postgres` role, evidently not a full superuser in this stack —
worked around by explicitly reversing the specific grants made instead.)

**Result** (re-run twice for reproducibility):

```
SERVER_DB_EXECUTION_MODEL_READY = YES
WORKER_DB_EXECUTION_MODEL_READY = YES
workerAppliedVerifiedTransitionRealFlow = true
workerReclaimedExpiredReservationRealFlow = true
appActivatesAndReachesRealDomainLogic = true   (submit_native_checkout reaches
                                                 real domain logic under an
                                                 activated persi_app identity)
mixedConcurrencyCycles = 50, zero leakage (app/worker/postgres, all directions)
poolReuseAfterConcurrency = true
expectedErrors: 6/6 correct SQLSTATEs (42501 ×5, 22023 ×1), zero contaminations
roles confirmed NOLOGIN (persi_app/persi_worker) / LOGIN (the two *_login roles)
```

Real deployment provisioning (staging/production) is documented here as an
ops runbook, not created: `CREATE ROLE persi_app_login LOGIN NOINHERIT
PASSWORD '<secret-manager-generated>'; GRANT persi_app TO persi_app_login
WITH INHERIT FALSE, SET TRUE;` (same shape for the worker role), followed by
setting `NATIVE_APP_DATABASE_URL`/`NATIVE_WORKER_DATABASE_URL` to connection
strings using those credentials.

## 5. Customer identity (guest vs. authenticated checkout)

`services/woocommerce/orders.ts`'s `createPendingOrder` already accepts
`customerId` as optional — the current commercial checkout **already
supports guest checkout**. No `external_mappings` row or resolver from a
WooCommerce/account session to a native `customers.id` exists anywhere
(confirmed by grep). Conclusion: native checkout v1 supporting **guest
checkout only** (already built, unchanged here) is a legitimate,
commercially-consistent v1 slice, not a regression — Woo already treats
guest as first-class. Authenticated native checkout needs a real
customer-resolution mechanism that doesn't exist yet; documented, not
built. **Reclassified from [87](87-staging-readiness-package.md)'s
"blocking-for-staging-if-required" to `OPERATIONAL_FOLLOWUP`** for the v1
canary slice specifically.

## 6. Canary identity contract (design only, not activated)

Server-authoritative, fail-closed eligibility: canary membership decided
from a deterministic hash of `checkoutId` (already server-generated, never
browser-chosen) against a configured percentage threshold read from an env
var — never from a browser-supplied flag, email, or hardcoded ID list.
Specified as a future function signature (`isCheckoutInNativeCanary(checkoutId,
samplePercent): boolean`, pure, no side effects); not built or wired this
round.

## 7. HTTP boundary regression

`app/api/checkout/native/route.ts` re-verified unchanged: still fails
closed (`isNativeCheckoutRuntimeEnabled()` hardcoded `false`), still accepts
no authoritative field from the browser. The execution-identity model is
orthogonal to it — a future round enabling the HTTP boundary would also need
to configure `NATIVE_APP_DATABASE_URL`/`NATIVE_WORKER_DATABASE_URL` for the
underlying DB calls to succeed under real (non-superuser) grants; both
gates are independent and both currently closed.

## 8. Regression

- `npx tsc --noEmit`: clean.
- `npx eslint`: clean on every changed/new file.
- `npm test`: 1424/1425 (added 6 new tests for `withPersiRole`'s fallback
  and activated-path shape; same one pre-existing, unrelated
  `tests/instagramFeed.test.mjs` failure noted since
  [81](81-drizzle-datetime-error-cause-audit.md)).
- `supabase test db` (pgTAP) after `supabase db reset --local`: 737/737.
- Every native-commerce real-Postgres script from prior rounds re-run on a
  fresh DB through the (unchanged-behavior) fallback path: all pass.
- **One pre-existing, unrelated flake found and diagnosed, not
  introduced by this round**: `scripts/database/native-checkout-payment-concurrency.mjs`
  intermittently reports a false-negative (`unrecognizedRejectionCount>0`
  or `noDuplicateProviderInvocation:false`) under its own 20-way concurrent
  submission race. Confirmed by temporarily reverting `lib/db/nativePayment.ts`
  to its pre-this-round content and re-running the identical script 3
  times: 2 of 3 failed the same way with the *original, untouched* code —
  proving this is a latent race in a prior round's own claim-gate/rejection-
  classification logic, unrelated to `withPersiRole`'s fallback (which is a
  pure no-op wrapper, verified by inspection: `if (!pool) return
  callback(getDatabase())`, byte-for-byte the old call). Not fixed here —
  out of scope for the execution-identity task; flagged for whichever round
  owns `services/checkout/nativeCheckoutService.ts`'s claim-gate composition.
- `npm run build:offline`: PASS, 0 real external requests.

## 9. What this round does NOT do

- Does not provision real login roles in any shared environment (local dev
  Postgres, staging, or production) — only inside its own disposable test
  run, fully cleaned up.
- Does not fix `readCheckoutPriceAuthority`'s grant gap (§3.3) or the
  pre-existing concurrency flake (§8) — both documented, neither introduced
  or owned by this round.
- Does not activate `NATIVE_APP_DATABASE_URL`/`NATIVE_WORKER_DATABASE_URL`
  anywhere.
- Does not touch `NATIVE_CHECKOUT_MODE` or `isNativeCheckoutRuntimeEnabled()`.
- Does not build authenticated native customer identity or activate any
  canary logic.
