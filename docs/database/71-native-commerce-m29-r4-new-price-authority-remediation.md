# M29-R4 — new commercial authority remediation

Date: 2026-09-06
Mode: local, strict offline, disposable PostgreSQL only

## Status

R4 stopped during its first fresh diagnostic execution because Docker Desktop
reported `Docker Desktop is unable to start`. The failure occurred before a new
disposable PostgreSQL environment could be created.

Per the R4 failure policy, no automatic retry, M29 correction, M30 creation, or
canonical/staging/production operation was performed.

## Preserved evidence

H3 had already established the minimal externally observable boundary:

- an initial authority submits successfully;
- a newly created authority resolves directly and matches its checkout snapshot;
- the nested resolver invoked by `submit_native_checkout` reaches its `not found`
  branch and returns `23514 / CHECKOUT_PRICE_STALE`;
- reuse of a pre-existing authority succeeds;
- no price ID, amount, assignment, currency, validity, or fingerprint mismatch
  exists immediately before the failing call.

R4 added disposable-only diagnostic support to compare the failing checkout on
the reused application backend and a fresh authentic backend, and to capture
the PostgreSQL function catalog. That comparison did not execute because of
the Docker infrastructure failure, so the exact internal cause remains
unproven and M29 remains unchanged.

## Hash gate

Pre-R4 M29 SHA-256:

`1cb4f4d50377270c999d87025774211d15c444bb15caae670101fa3166b44ee4`

Post-R4 M29 SHA-256: unchanged.

Migrations 1–28 were not modified by R4. Migration 30 was not created.

## Required continuation

After Docker Desktop is confirmed healthy, restart R4 from the fresh disposable
PostgreSQL step and execute the reused-backend versus fresh-backend control.
Do not modify M29 until the exact PostgreSQL/PLpgSQL cause is objectively proven.

## R4-R1 resumption

R4-R1 resumed on 2026-09-06 with the required harmless Docker preflight.

- Docker client: `29.7.2`;
- context: `desktop-linux`;
- `docker version` server response: unavailable;
- `docker info` daemon response: `Docker Desktop is unable to start`;
- local image inspection: unavailable because the daemon did not respond;
- residual disposable-container inspection: unavailable for the same reason;
- migration-file count: `29`;
- pre-R4 M29 SHA-256: unchanged and valid.

The phase stopped as `M29_R4_R1_INFRASTRUCTURE_BLOCKER` before any database or
container action. No daemon remediation, image pull, container removal,
canonical operation, migration change, staging access, or production access was
attempted. The reused-backend/fresh-backend comparison remains the first exact
action after the Docker daemon is confirmed running.

## R4-R1 diagnostic and remediation result

Docker subsequently recovered (`29.7.2`, `overlayfs`), the required PostgreSQL
17.6 image was present locally, and no residual `persi-r4c` container was
listed.

The minimal reproduction established that backend reuse was not causal:

- authority A submitted successfully;
- authority B, created and committed after A, resolved directly;
- B failed on both the reused backend and a fresh `prepare:false` backend;
- nested resolver arguments were correct;
- transaction visibility, old timestamps, and client prepared statements were
  excluded.

Disposable-only predicate instrumentation showed that the nested resolver was
receiving the item variant from authority A together with the price list from
authority B. Inspection of M29 identified the exact defect: its stale-price
`EXISTS` scanned every row in `checkout_session_items` because it did not scope
the rows to the submitted checkout.

Root-cause classification: `M29_AUTHORITY_LOOKUP_DEFECT`.

The narrow M29-only correction added `i.checkout_session_id = s.id` to that
`EXISTS`, preserving all four stale checks, `SECURITY DEFINER`, `search_path=''`,
grants, resolver behavior, and fingerprint semantics.

Post-R4 candidate M29 SHA-256:

`09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a`

A completely fresh disposable database applied migrations 1–29 and proved:

- authority A: PASS;
- authority B created after A: PASS;
- same reusable application pool/backend condition: PASS;
- direct and snapshot fingerprints: exact match;
- reconnect requirement: none.

The subsequent focused regression hard-stopped at the unrelated harness-only
scenario `PRICE_SALE_ACTIVATION_FIXTURE_READY`. Its generated synthetic slug
contained an underscore (`price-sale_activation-...`) and violated
`products_slug_check`. Per the R4-R1 failure policy, that fixture was not
auto-corrected and the remaining regression/stress gates were not run.

## R4-R2 harness slug remediation and validation

R4-R2 proved the slug failure was harness-only. The database constraint is
`^[a-z0-9]+(?:-[a-z0-9]+)*$`, while `buildReady` previously copied scenario
labels containing underscores directly into product slugs.

A harness-only `createSyntheticSlug` helper now keeps scenario IDs unchanged
while producing lowercase, hyphenated, collision-safe database slugs. Focused
tests cover underscores, uppercase input, repeated/edge separators, invalid
empty inputs, the actual constraint pattern, and preservation of unique
suffixes. Production slug code was not changed.

A fresh PostgreSQL 17.6 disposable database applied all 29 migrations. The
functional harness completed 65 labeled scenarios with zero unlabeled errors:

- customer valid, wrong owner, UUID-only, and override controls: PASS;
- unchanged price: PASS;
- increase, decrease, sale activation, sale expiry, validity, and assignment
  changes: expected `CHECKOUT_PRICE_STALE`, zero orders;
- 20 double-submit cycles: PASS;
- 20 divergent-hash cycles: PASS;
- deadlocks, timeouts, and duplicates: zero;
- inventory submission deltas and sale movements: zero;
- order aggregate, initial event, reservation link, converted cart, checkout
  finalization, and temporary PII cleanup: PASS.

The global `npm test` regression then hard-stopped because
`tests/runtimeDatabaseFunctionalSubmission.test.mjs` still asserts the
historical pre-R4 hash `1cb4…`. The authoritative R4 candidate remains
`09878…`. Since R4-R2 authorized only the synthetic-slug correction, this
second harness/test expectation was not automatically changed. Remaining
typecheck, lint, pgTAP, and build gates were not run after the hard stop.

## R4-R3 test hash expectation and regression

The historical-hash audit classified the occurrences in docs 66–71 as
intentional historical evidence. The only stale current-candidate expectation
was in `tests/runtimeDatabaseFunctionalSubmission.test.mjs`; it was updated
from `1cb4…` to the explicitly pinned R4 candidate `09878…`. No historical
document, migration, runtime file, or production implementation was changed by
R4-R3.

The focused hash, price-scope, and synthetic-slug tests passed. The Raw PII
test then failed independently of the hash expectation: the default Node ESM
runner cannot resolve the `@/lib` alias imported transitively by
`lib/commerce/checkoutPii.ts` without the repository TypeScript loader. The Raw
PII assertions themselves were not weakened or changed.

This is a new test-harness execution defect outside R4-R3's authorized hash-only
correction. Per the failure policy, R4-R3 hard-stopped without changing loader
configuration, package scripts, imports, production code, or M29. Full npm
test, pgTAP, typecheck, lint, and offline build closure remain pending.

## R4-R4 TypeScript alias remediation and final regression

The Raw PII failure was reproduced with the plain Node test command as
`ERR_MODULE_NOT_FOUND` for the `@/lib` alias imported by
`lib/commerce/checkoutPii.ts`. The repository's existing
`scripts/database/typescript-loader.mjs` was then proven command-only to resolve
both the alias and TypeScript source. The package-level test command now uses
that existing loader together with the already-required `react-server`
condition. No Raw PII assertion, production runtime source, migration, or
application import was changed.

Focused Raw PII, M29 hash/configuration, checkout price-scope, and synthetic
slug tests passed (5/5). The complete Node suite ran 708 tests: 707 passed and
the only failure was the documented unrelated Instagram expectation for
`InstagramCarousel` versus the current `InstagramCarouselLazy`. The M29-relevant
Node regression therefore passed while the raw global npm result remains fail.

A fresh PostgreSQL 17.6 disposable database in tmpfs applied all 29 migrations
and completed the functional harness: 65/65 labeled scenarios passed, including
guest/customer authorization, unchanged and six stale-price cases, 20
double-submit cycles, 20 divergent-hash cycles, inventory invariance, initial
event, idempotency, tax-document transformation, and aggregate atomicity. There
were zero unlabeled errors, deadlocks, timeouts, duplicate orders, sale
movements, privilege leaks, or external requests. The disposable container was
removed.

The full pgTAP run against a separate disposable PostgreSQL database executed
493 assertions across 16 files and failed. Thirteen files passed. The failures
were 6 assertions in `native_cart_foundation.test.sql` (historical function
signatures), 1 assertion in
`native_checkout_order_integrity_hardening.test.sql`, and 3 assertions in
`native_order_foundation.test.sql` (expected historical
`order_snapshot_immutable`, actual current `order_child_immutable`). No
canonical database write occurred, and the disposable container was removed.
Because these are relevant native-commerce pgTAP failures, R4-R4 hard-stops and
does not claim full phase approval or proceed to M29-D.

Typecheck passed. Lint passed with zero errors and five existing warnings. The
offline build reached Next.js compilation and failed only at the documented
Google Inter fetch blocker; the offline guard recorded zero actual external
requests. `git diff --check` passed (line-ending warnings only).

M29 remained byte-identical with SHA-256
`09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a`.
There are 29 migration files and no M30. Read-only canonical S0 and S1 were
identical: PostgreSQL 17.6, history 28, last applied `20260905130000`, zero
`submit_native_checkout` persistent functions, and stores/carts/orders
`0/0/0`. Staging and production were not accessed.

## R4-R5 PGTAP CONTRACT RECONCILIATION

R4-R5 reproduced the three failing files unchanged in a fresh PostgreSQL 17.6
database after applying migrations 1–29. The focused result was 139 assertions
with 10 reported failures. No test or migration had been edited at that point.

### Individual original-failure classification

| Assertion | Old expectation | Current contract and evidence | Classification | Changed/new assertion |
| --- | --- | --- | --- | --- |
| cart 32, `add item` | 3-argument `add_native_cart_item(cart,variant,quantity)` lives | M29 drops that overload and exposes the 5-argument, owner-bound security-definer function | intentional contract evolution | no; hard stop |
| cart 33, `same item adds atomically` | same 3-argument overload lives | same catalog/M29 owner-binding evidence; atomic add remains in the 5-argument implementation | intentional contract evolution | no; hard stop |
| cart 34, `add quantities summed` | quantity becomes 5 after assertions 32–33 | actual NULL is only fallout from both obsolete calls failing before mutation | stale dependent expectation | no; hard stop |
| cart 35, `zero rejected` | old overload raises `cart_quantity_must_be_positive` | current 5-argument API raises `CART_QUANTITY_INVALID` after explicit owner inputs; old overload is deliberately absent | intentional contract evolution | no; hard stop |
| cart 36, `set quantity` | 3-argument `set_native_cart_item_quantity` lives | M29 drops it and exposes the owner-bound 5-argument security-definer API | intentional contract evolution | no; hard stop |
| cart 37, `set is authoritative` | quantity becomes 4 after assertion 36 | actual NULL is fallout from the obsolete set call | stale dependent expectation | no; hard stop |
| integrity 33, `event remains append only` | mutation rejected as `order_snapshot_immutable` | M29 intentionally replaces the guard body; child updates raise `order_child_immutable`, while deletes remain `order_history_delete_forbidden` | intentional contract evolution | no; hard stop |
| order 50, `item immutable` | `order_snapshot_immutable` | `order_items_immutable` still invokes `enforce_native_order_immutability`; M29 strengthens/separates the child error to `order_child_immutable` | intentional contract evolution | no; hard stop |
| order 52, `adjustment immutable` | `order_snapshot_immutable` | `order_adjustments_immutable` uses the same current guard and rejects the mutation as `order_child_immutable` | intentional contract evolution | no; hard stop |
| order 59, `event append only` | `order_snapshot_immutable` | `order_status_events_append_only` uses the same current guard and rejects rewriting history as `order_child_immutable` | intentional contract evolution | no; hard stop |

The catalog audit confirmed the current cart functions are volatile,
`SECURITY DEFINER`, owned by `postgres`, use `search_path=''`, and grant execute
only to `postgres`, `service_role`, and `persi_app`. Their current signatures
are owner-bound: add/set take cart, customer, guest fingerprint, variant and
quantity; remove takes the same inputs without quantity; merge takes guest
cart, customer cart, customer and guest fingerprint. M29 explicitly drops all
four historical overloads.

Before the authorized test reconciliation, the mandatory all-call-site audit
found a separate blocker: `scripts/database/native-cart-concurrency.mjs` still
invokes the historical add/merge signatures, and
`scripts/database/native-checkout-concurrency.mjs` still invokes the historical
add signature. These executable validation harnesses are outside the R4-R5
allowed-file list. Therefore the required `no stale runtime call signature`
gate failed and is classified as `REAL_FUNCTION_SIGNATURE_REGRESSION` in the
validation ecosystem. Per the phase failure policy, R4-R5 hard-stopped without
modifying any pgTAP test, runtime source, migration, or M29. Mutation proofs,
focused/full post-change pgTAP, and downstream regression gates were not run.

## R4-R6 validation call-site signature remediation + pgTAP contract reconciliation

The repository-wide call-site audit found no unknown cart calls. Historical
executable calls were confined to the two authorized concurrency scripts and
`native_cart_foundation.test.sql`; historical definitions/revocations in the
immutable B3-B/M29 migrations remained documentation of schema evolution.

`native-cart-concurrency.mjs` now supplies the fixture's actual guest
fingerprint to add and merge operations. `native-checkout-concurrency.mjs` now
supplies the mutation scenario's actual guest fingerprint. No arbitrary
authority value, compatibility overload, superuser bypass, or production call
site was introduced.

The cart pgTAP fixture now supplies the real fixture authority for every add,
set, remove, and guest-to-customer merge: guest cart operations use customer
NULL plus `repeat('a',64)`; customer cart operations use the fixture customer
UUID plus guest NULL; merge uses both the target customer and source guest
fingerprint. The invalid-quantity assertion now expects the current
`CART_QUANTITY_INVALID` contract. Twelve additional semantic/catalog assertions
prove all four current signatures, absence of all four historical overloads,
security-definer behavior, empty search path, postgres ownership, app execute,
and anon denial. Assertions removed/skipped/weakened: zero.

The four previously classified child-update assertions now expect the proven
`order_child_immutable` error only at their exact trigger paths. Delete/history
and root/status assertions were not globally replaced or weakened.

A fresh PostgreSQL 17.6 disposable database applied migrations 1–29. The three
focused reconciled pgTAP files passed 3/3 with 166 assertions and zero failures.

The next gate, updated `native-cart-concurrency.mjs`, then found a distinct
harness-cleanup defect during its first cycle. The functional merge completed,
but line 40 attempted direct deletion of items belonging to the now-terminal
merged cart. The current M29 mutability trigger correctly rejected that cleanup
with SQLSTATE `23514`, `CART_NOT_MUTABLE`. This is not signature drift and is a
second class of harness remediation not authorized by R4-R6. The phase therefore
hard-stopped without changing cleanup behavior or running checkout concurrency,
full pgTAP, the full functional harness, npm/typecheck/lint/build, or the later
mutation/security gates. The disposable database was removed.

## R4-R7 terminal cart harness cleanup + final R4 regression

R4-R7 reproduced the cleanup failure unchanged in a new PostgreSQL 17.6
disposable database: merge succeeded, the source cart became `merged`, and the
per-cycle direct `cart_items` deletion was correctly rejected with SQLSTATE
`23514`, `CART_NOT_MUTABLE`.

The lifecycle audit proved every cycle already uses collision-resistant UUIDs,
guest fingerprints, emails, product slugs and SKUs. No following cycle depends
on deleting prior fixtures. The narrow correction therefore removed per-cycle
terminal-object deletion from `native-cart-concurrency.mjs` and requires
`PERSI_DISPOSABLE_DATABASE=1`. Final physical cleanup is database/container
destruction. No trigger, status, constraint, RLS, grant, or session replication
setting is bypassed.

The checkout harness used the shared cleanup helper, which disables triggers
through `session_replication_role=replica` and mutates terminal fixture graphs.
For this disposable-only matrix it now follows the same lifecycle rule: unique
fixtures remain until database destruction, the bypassing helper is no longer
imported/called, and `PERSI_DISPOSABLE_DATABASE=1` is mandatory. The helper
itself was not changed because it is shared outside this authorized scope.

Twenty cart cycles passed with zero failures, fixture collisions, cleanup
errors, or terminal cleanup mutations. Twenty checkout cycles covering six
scenarios and 220 concurrent executions passed with zero failures, collisions,
cleanup errors, terminal cleanup mutations, or overselling. Retained cart
fixtures were operationally trivial: 20 stores, 20 customers, 20 products, 20
merged carts, and 40 related cart-item rows before disposable destruction.

The reconciled pgTAP suite was run in a separate clean disposable database so
its deliberately global baseline assertions were isolated from retained
concurrency fixtures. Focused pgTAP passed 3/3 files and 166 assertions; the
complete suite passed 16/16 files and 520 assertions, with zero failures.
Order item/address/adjustment/event update and delete guards plus the legal
status transition were covered by the passing order suites.

The full functional runtime harness passed all 65 labeled scenarios. It
preserved guest and customer authorization negatives, current cart terminality,
six stale-price cases, 20/20 double submits, 20/20 divergent-hash conflicts,
idempotency, initial event, tax transformation, inventory invariance, and the
pending payment boundary, with zero unlabeled errors, deadlocks, timeouts, or
duplicates.

The Node regression ran 708 tests: 707 passed and the sole failure remained the
documented unrelated Instagram carousel expectation. All native-commerce/M29
tests passed. Typecheck passed when run sequentially after the offline build;
an earlier parallel invocation raced with Next.js rewriting `.next/types` and
was discarded as an invocation artifact. Lint passed with zero errors and five
existing warnings. Offline build failed only on the documented Google Inter
fetch dependency, while the guard recorded zero actual external requests.

## R4-C-FINAL complete disposable validation matrix

The zero-fix final matrix ran against fresh PostgreSQL 17.6 disposable
databases using the existing local image, `--pull never`, loopback dynamic
ports, tmpfs, and no shared/canonical volume. Migrations 1–29 applied without
skip, patch, or repair.

Schema inspection confirmed `submit_native_checkout` exists as a
postgres-owned `SECURITY DEFINER` function with `search_path=''`; PUBLIC, anon,
authenticated and `persi_worker` cannot execute it, while `persi_app` can. The
database contains 53 RLS-enabled public relations. Current protected cart APIs,
terminal guards, order immutability/state transition, price authority and
inventory linkage were exercised by the complete matrices.

Cart concurrency passed 20 cycles/3 scenarios with zero failures, collisions,
cleanup errors or terminal cleanup mutations. Checkout concurrency passed 20
cycles/6 scenarios/220 executions with zero failures or overselling. Raw PII,
temporary-to-durable tax transformation, checkout readiness, local shipping
evidence, authority A/B/subsequent reuse, cross-checkout isolation, unchanged
price and all six stale-price cases passed in the integrated functional suite.

The authentic-role functional harness passed 65/65 labeled scenarios with zero
unlabeled errors. Double submit passed 20/20 and divergent request hash passed
20/20; deadlocks, timeouts and duplicates were zero. The successful submission
created one pending order, converted its cart, finalized checkout, copied one
item/two addresses/one initial event, linked the active reservation and cleared
temporary PII. Submission added zero reservation or SALE movements and changed
neither on-hand nor reserved quantity.

A separate clean disposable database passed all 16 pgTAP files and 520/520
assertions. The Node suite ran 708 tests: all 707 non-Instagram tests passed and
the sole failure remained the known unrelated `InstagramCarousel` versus
`InstagramCarouselLazy` expectation. Typecheck passed sequentially; lint passed
with zero errors and five unchanged warnings. Offline build failed only on the
known Google Inter fetch dependency, with zero actual external requests.

M29 remained byte-identical at
`09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a`.
Canonical S0/S1 remained PostgreSQL 17.6, history 28, last migration
`20260905130000`, zero M29 persistent function, and stores/carts/orders 0/0/0.
No source, test, harness, or migration was modified by R4-C-FINAL; this section
is its only documentation change.

## M29-D post-canonical-local-rebuild validation

The single authorized canonical local reset had already completed successfully
before this validation. It was not repeated. The post-rebuild baseline and the
final read-only audit both reported PostgreSQL 17.6, 29 migration-history rows,
last version `20260905180000`, one persistent `submit_native_checkout`
function, 53/53 public tables with RLS, and stores/carts/orders `0/0/0`.

The canonical-safe integrated harness created only synthetic fixtures inside a
transaction and rolled them back. Checkout preparation, encrypted PII
persistence, transition to `ready`, terminal-state protection, and composition
readiness passed. The final function audit confirmed postgres ownership,
`SECURITY DEFINER`, `search_path=""`, execute for `persi_app`, and denial for
`persi_worker`, anon, authenticated, and PUBLIC.

The complete authentic-role functional matrix ran in an independent tmpfs
PostgreSQL 17.6 container and passed 65/65 labeled scenarios. It covered guest
and customer authorization, terminal carts, unchanged and six stale-price
cases, shipping/price/inventory authority, durable tax transformation, atomic
pending-order creation, order number/event/aggregate invariants, 20/20
double-submit cycles, and 20/20 divergent-hash cycles. Deadlocks, timeouts,
duplicate orders, role leakage, privilege escalation, overselling, payment
starts, and external requests were all zero. The disposable database was
removed.

The pgTAP suite ran in a separate clean disposable PostgreSQL 17.6 database
after all 29 migrations and explicit runner bootstrap of pgTAP in the
`extensions` schema. All 16 files and 520/520 assertions passed with zero
failures; the container was removed.

The Node suite remained at 707/708, with the only failure being the documented,
unrelated Instagram carousel expectation. All native-commerce/M29 tests passed.
Typecheck passed. Lint passed with zero errors and five existing warnings. The
offline build reached Next.js compilation and failed only because the Inter
Google Font could not be fetched; the offline guard recorded zero actual
external requests. `git diff --check` passed with line-ending warnings only.

M29 remained byte-identical at
`09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a`.
There are 29 migration files and no M30. No migration, source, test, or harness
was changed in M29-D. Staging and production were not accessed. The M29-D
native-commerce gate passes and the repository is safe to proceed to the E1
preflight only; E1 was not started.

## M29-E1 cart authority + concurrency stress

E1 hard-stopped during preflight because the required executable validation
coverage does not exist in the current repository. The existing
`native-cart-concurrency.mjs` harness is correctly disposable-only, but is
fixed at 20 cycles and covers only three scenarios: concurrent add/add,
customer-cart uniqueness, and merge/add. It does not implement the mandated
eight 50-cycle families (add/lock, set/lock, remove/lock, new-item/lock,
merge/lock, close boundary, converted mutation, and version contention), nor
the required per-cycle version, lost-update, phantom, timeout, and authentic
runtime-identity measurements. The repository-wide search found no alternate
harness implementing those families.

Because E1 is explicitly zero-fix and prohibits creating or modifying a test
harness, running the available 20-cycle matrix would not satisfy or honestly
represent the E1 success criteria. No stress database was started and no
partial family was reported as passing.

The read-only preflight remained healthy: PostgreSQL 17.6, 29 migration files
and 29 history rows, last version `20260905180000`, one persistent M29 function,
M29 SHA-256
`09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a`,
no M30, and canonical stores/carts/orders `0/0/0`. `git diff --check` passed
with line-ending warnings only. No reset, external request, staging access,
production access, commit, or push occurred.

Blocker classification: `E1_REQUIRED_CONCURRENCY_HARNESS_COVERAGE_MISSING`.
The next safe action is a separately authorized offline harness-construction
phase, followed by a clean E1 restart. E2 is not authorized.

## M29-E1-H concurrency harness construction

E1-H created the dedicated test-only harness
`scripts/database/native-cart-e1-concurrency.mjs`. It requires both
`PERSI_OFFLINE_VALIDATION=1` and `PERSI_DISPOSABLE_DATABASE=1`, requires
explicit admin/app disposable URLs, accepts loopback only, and refuses the
canonical port 15422 before connecting. Self-tests proved fail-closed behavior
for a missing disposable flag, a flag other than `1`, and the canonical target.

The harness implements the eight requested families with configurable cycles,
defaults to 50 outside explicit `HARNESS_SELF_TEST_ONLY=1`, uses a restricted
`persi_e1_app_login` followed by transaction-local `SET LOCAL ROLE persi_app`,
and records family distributions, authority failures, terminal mutations,
duplicates, lost updates, version mismatches, deadlocks, timeouts, role leakage,
and unlabeled errors. Family F uses the existing legal checkout cancellation
boundary (`locked -> active` via `close_native_checkout`); Family G reaches
`converted` through the complete native submission path. Terminal fixtures are
left for disposable-container destruction.

The first executable self-test found and corrected a harness-only idempotency
key mismatch in Family G. A second harness-only correction normalized bigint
result comparisons and added nominal negative-operation diagnostics without
weakening any assertion.

The next two-cycle self-test then discovered a real M29 authorization defect
and hard-stopped the phase. In 2/2 cycles, `WRONG_CUSTOMER` successfully called
`add_native_cart_item` against a guest-owned cart. The current authority
predicate compares the guest cart's NULL `customer_id` to a supplied non-NULL
customer UUID. That comparison yields NULL; the combined predicate can remain
NULL, and PL/pgSQL `IF NOT (predicate)` does not execute for NULL. The operation
therefore bypasses the intended `CART_OWNERSHIP_INVALID` denial. This affects
the shared predicate shape in the current cart mutation functions and is
classified as `M29_CART_AUTHORITY_NULL_TRI_STATE_BYPASS`.

No database/runtime/migration correction was made. Qualification runs, old
harness regressions, pgTAP, functional DB, npm, typecheck, lint, and build were
not run after the required hard stop. Every disposable E1-H container was
removed. Canonical S0/S1 remained PostgreSQL 17.6, history 29, last migration
`20260905180000`, and stores/carts/orders `0/0/0`. M29 remained byte-identical
at `09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a`;
no M30 was created. Staging and production were not accessed.

## M29-E1-R1 / M30 cart authority null-safe remediation

The authority call-graph audit found the same nullable predicate in
`add_native_cart_item`, `set_native_cart_item_quantity`, and
`remove_native_cart_item`. Each could evaluate to SQL UNKNOWN for a guest cart
when a non-NULL customer UUID was supplied. `merge_native_carts` already uses
`IS DISTINCT FROM`; checkout preparation also uses null-safe comparisons and
explicit presence checks; cart creation uses binary `IS NULL` predicates. No
unknown authority predicate remained in the audited surrounding call graph.

M30 was created as
`20260907120000_native_cart_authority_null_safe.sql`. It replaces only the
three vulnerable functions, preserves their signatures, locking, quantity and
version behavior, `SECURITY DEFINER`, ownership, empty search path, and existing
ACLs. It adds no table, column, enum, data migration, overload, RLS change, or
grant. Customer carts now require the exact customer plus NULL guest input;
guest carts require NULL customer plus the exact non-NULL stored fingerprint.
The explicit final check is `authorized IS NOT TRUE`, so UNKNOWN fails closed.

Six pgTAP assertions were added to the existing cart suite for the exact guest
plus wrong-customer bypass, symmetric add/set/remove and customer-plus-guest
denials, and preservation of guest quantity/version. No assertion was removed.

Before M30, the authentic-role E1 self-test reproduced unauthorized
`WRONG_CUSTOMER` success in 2/2 cycles. After applying migrations 1-30 in a
fresh disposable PostgreSQL 17.6 database, the focused E1 self-test passed all
eight families for 2 cycles each (16 family cycles, 58 app operations).
Unauthorized successes fell from 2 to 0; post-terminal successes, lost updates,
duplicates, version mismatches, deadlocks, lock/statement timeouts, role
leakage, authority contamination, forced reconnects, and unlabeled errors were
all zero. Two expected converted-fixture orders and zero SALE movements were
observed. The disposable container was removed.

The pre-canonical gate then hard-stopped on a newly exposed test-infrastructure
compatibility blocker: `runtime-identity-functional-validation.mjs`, the
required 65/65 functional suite, asserts `migrations.length === 29`. With the
authorized M30 file present it necessarily fails before executing its database
matrix. That harness is outside the E1-R1 authorized modification scope. It was
not changed or bypassed, and M30 was therefore not applied to the canonical
database.

Canonical final state remains PostgreSQL 17.6, history 29, last migration
`20260905180000`, and stores/carts/orders `0/0/0`. M29 remains
`09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a`.
The unapplied M30 candidate hash is
`db393c838157b3581eb269042835ace265b97be86f34f840f69ecf9436d1ed6c`.
No reset, remote access, external request, commit, or push occurred. Blocker:
`M30_FUNCTIONAL_HARNESS_MIGRATION_COUNT_PINNED_TO_29`.

## M29-E1-R1-H1 functional harness migration count

The migration-pin audit classified the 29-count in
`runtime-identity-functional-validation.mjs` as a stale exact repository
baseline. Its M29 hash remained an intentional M29-specific integrity check.
Pins in the older disposable identity/pool harnesses refer to their historical
R4 scope and pre-revision hash and were not changed. Unknown pins: zero.

The functional harness was changed test-only from an exact count of 29 to 30,
with an additional assertion that
`20260907120000_native_cart_authority_null_safe` is the final migration and an
independent M30 SHA-256 check. The existing independent M29 SHA-256 check was
preserved. Assertions removed/skipped: zero; coverage weakened: no.

With migrations 1-30, the functional database harness passed 65/65 labeled
scenarios, including 20/20 double submits and 20/20 divergent hashes, with zero
unlabeled errors. The existing cart harness passed 20 cycles/3 scenarios. The
checkout harness passed 20 cycles/6 scenarios/220 executions with zero
overselling. The focused E1 self-test passed 8/8 families, 2 cycles per family,
16 family cycles and 58 app operations; unauthorized successes,
post-terminal successes, lost updates, duplicate items, version mismatches,
deadlocks, timeouts, role leakage, authority contamination and unlabeled errors
were all zero.

A separate clean PostgreSQL 17.6 database passed all 16 pgTAP files and 526/526
assertions, including the six new null-safe authority regressions, with zero
failures and zero removed assertions. The Node suite remained 707/708 with only
the known unrelated Instagram carousel expectation; all native-commerce/M30
tests passed. Typecheck passed. Lint passed with zero errors and the same five
warnings. The offline build failed only on the known Google Inter fetch blocker
and recorded zero actual external requests.

The pre-canonical gate passes, but H1 deliberately did not apply M30.
Canonical S0/S1 remained PostgreSQL 17.6, history 29, last migration
`20260905180000`, and stores/carts/orders `0/0/0`. M29 and M30 retained hashes
`09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a`
and `db393c838157b3581eb269042835ace265b97be86f34f840f69ecf9436d1ed6c`.
No M31, second reset, remote access, external request, commit, or push occurred.

## M29-E1-R1-H2 M30 canonical local application

The pre-application target was positively identified as the canonical local
Supabase PostgreSQL 17.6 endpoint at `127.0.0.1:15422`. It had 29 migration
history rows, last version `20260905180000`, zero stores/carts/orders, 30 local
migration files, and exactly one pending file:
`20260907120000_native_cart_authority_null_safe.sql`. M29 and M30 matched their
frozen hashes.

The single authorized non-destructive application used
`supabase migration up --local`. It applied exactly M30 and succeeded on the
first invocation. No retry, reset, linked project, manual function patch, or
history repair occurred. Canonical history became 30 with M29 immediately
followed by M30 and no pending migration.

Post-application catalog inspection confirmed the four current owner-bound
signatures and absence of all historical overloads. All four functions remain
postgres-owned `SECURITY DEFINER` routines with `search_path=""`; `persi_app`
retains execute, while `persi_worker`, PUBLIC, anon, and authenticated remain
denied. The three replaced routines contain the installed fail-closed
`authorized IS NOT TRUE` check.

For authentic canonical proof, a transient restricted login with only SET
membership in `persi_app` and synthetic local fixtures were created. Through
`restricted login -> BEGIN -> SET LOCAL ROLE persi_app`, the exact guest-cart
plus wrong-customer exploit returned SQLSTATE 42501 and
`CART_OWNERSHIP_INVALID`. Wrong fingerprint, NULL fingerprint, wrong customer,
and UUID-only cases were also denied. Unauthorized item and version deltas were
zero. Correct guest and customer calls passed, and a locked-cart mutation was
rejected as `CART_NOT_MUTABLE`. All tested operations were rolled back.

The fixtures, transient login, and temporary proof file were then removed.
Final canonical counts were stores/customers/carts/checkout_sessions/orders/
inventory_reservations/inventory_movements `0/0/0/0/0/0/0`. History is 30,
last migration is `20260907120000`, and the transient role count is zero. M29
remains `09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a`;
M30 remains `db393c838157b3581eb269042835ace265b97be86f34f840f69ecf9436d1ed6c`.
No M31, second application, second reset, network call, staging/production
access, commit, or push occurred.

## M29/M30-E1-HR — E1 harness coverage remediation

The prior E1-HQ qualification stopped before Run 1 because the dedicated
harness did not exercise the exact M30 exploit arguments, lacked negative
merge coverage, and combined terminal metrics. E1-HR changed only
`scripts/database/native-cart-e1-concurrency.mjs`; migrations and production
runtime remained immutable.

The authority matrix now executes the exact guest-owned cart case with the
correct stored guest fingerprint and a wrong non-NULL customer UUID. It also
covers wrong and NULL guest fingerprints, UUID-only knowledge, wrong customer
authority on guest/customer carts, unrelated guest authority on a customer
cart, and wrong/NULL customer or fingerprint authority for merge. Every
rejected operation records item, quantity, version, source, and destination
stability. Dedicated M30 and merge attempt/success counters are emitted.

Locked, merged, and converted terminal probes now have separate attempt and
success counters. The JSON summary also exposes family cycles, race outcomes,
data/version invariants, concurrency health, role/pool isolation, and external
side effects. Its fail-closed evaluator rejects missing M30/merge attempts or
any required non-zero failure metric. A synthetic evaluator self-check proved
that attempts=0 and injected M30, merge, or post-converted successes all fail.
Self-test mode is explicitly `NOT_QUALIFICATION_EVIDENCE`, with
`QUALIFICATION_ELIGIBLE=false` and `FULL_QUALIFICATION_PASS=false`.

Guard checks rejected a missing disposable flag, a flag different from `1`,
and canonical `127.0.0.1:15422` before fixture creation. The successful fresh
PostgreSQL 17.6 disposable self-test applied 30/30 migrations through
`20260907120000`, ran 2 cycles for each family (16 family cycles and 81 app
operations), and passed 8/8 families. Authority negatives were 22/0; exact M30
was 2/0; wrong merge customer and fingerprint were each 2/0. Post-locked,
post-merged, and post-converted successes were zero. Lost updates, duplicates,
version mismatches, phantom items, partial merges, unauthorized deltas,
deadlocks, timeouts, role leakage, authority contamination, unlabeled errors,
SALE movements, and external calls were all zero.

Regression evidence: existing cart concurrency passed 20 cycles/3 scenarios;
checkout concurrency passed 20 cycles/6 scenarios/220 executions with zero
overselling; pgTAP passed 16/16 files and 526/526 assertions; functional DB
passed 65/65 with double-submit 20/20, divergent hash 20/20, and zero unlabeled
errors. `npm test` retained only the known unrelated Instagram baseline
(707/708). Typecheck passed; lint had zero errors and the same five warnings.
The strict offline build reached only the known Google Inter fetch blocker and
recorded zero actual external requests.

Canonical S0 and S1 were equal: PostgreSQL 17.6, history 30/30, last
`20260907120000`, and business counts `0/0/0/0/0/0/0`. M29 and M30 retained
their frozen hashes, M31 remained absent, no canonical reset/write occurred,
and no HR container remained. Network, staging, production, commit, and push
were all zero/not accessed. Full E1-HQ was not started.

## M29/M30-E1-HQ-R2 — full cart concurrency qualification

The immutable qualified harness SHA-256 was
`51c0e64bb4f7d0ebf56cf36e38609330d253518fc7e223674e8c7bf9b8f77183`
before Run 1, after Run 1, and after Run 2. Both runs used independent fresh
PostgreSQL 17.6 instances on dynamic loopback ports with tmpfs storage,
`--pull never`, strict offline/disposable guards, migrations 1–30, and the
restricted-login to `SET LOCAL ROLE persi_app` execution path.

Run 1 (`c7d24028-c7f9-4112-ab29-7de46ea5829a`, port 49281) passed 50 cycles
for each family, 400 family cycles, and 1,989 app operations. Race outcomes
were A 39/11, B 44/6, C 48/2, D 42/8, E 36/14, and F 47/3 for
mutation-first/transition-first; G produced 150 expected converted-cart
rejections and H completed all version-contention cycles. Authority negatives
were 550/0; exact M30, wrong merge customer, and wrong merge fingerprint were
each 50/0. Post-locked, post-merged, and post-converted attempts/successes were
81/0, 108/0, and 150/0.

Run 2 (`b40f4e1b-6445-4468-b722-291c58fd4077`, port 49307) passed 50 cycles
for each family, 400 family cycles, and 1,971 app operations. Race outcomes
were A 46/4, B 45/5, C 46/4, D 48/2, E 42/8, and F 47/3; G again produced
150 expected converted-cart rejections and H completed all contention cycles.
Authority negatives were 550/0; exact M30 and both merge negatives were each
50/0. Terminal attempts/successes were 45/0 locked, 126/0 merged, and 150/0
converted.

Combined qualification was 800 family cycles and 3,960 app operations.
Families A–F observed both legal serialization paths without timing changes.
G is a deterministic post-conversion denial contract and H is deterministic
successful additive/version accounting, so neither has a missing legal race
path. Across both runs, lost updates, duplicates, version mismatches, phantom
items, partial merges, unauthorized item/version deltas, deadlocks, lock or
statement timeouts, unexpected serialization errors, unlabeled errors, role
leakage, authority contamination, connection privilege leakage, SALE
movements, and external calls were all zero.

Post-HQ regression passed: pgTAP 16/16 and 526/526 on exclusive fresh state;
functional DB 65/65 with double-submit 20/20, divergent hash 20/20, and zero
unlabeled errors; existing cart 20 cycles/3 scenarios; existing checkout 20
cycles/6 scenarios/220 executions with zero overselling. `npm test` retained
only the known unrelated Instagram assertion (707/708), typecheck passed, and
lint had zero errors plus the existing five warnings. Offline build retained
only the known Google Inter blocker and recorded zero actual external requests.

Canonical S0/S1 remained equal at PostgreSQL 17.6, history 30/30, last
`20260907120000`, and business counts `0/0/0/0/0/0/0`. M29 and M30 hashes
remained frozen, the harness was unchanged, M31 remained absent, the second
reset was not attempted, and all HQ-R2 containers were removed. Staging and
production were not accessed; no commit or push occurred.

## M29/M30-E1-FINAL — final cart concurrency acceptance

The official independent E1 Final run used frozen harness SHA-256
`51c0e64bb4f7d0ebf56cf36e38609330d253518fc7e223674e8c7bf9b8f77183`
and fresh PostgreSQL 17.6 on dynamic loopback port 49659 with tmpfs,
`--pull never`, strict offline/disposable guards, and migrations 1–30. The
restricted-login to `SET LOCAL ROLE persi_app` path remained authentic, and
the harness hash was unchanged after execution.

Run `9d524b1a-13f7-4613-ac7a-4bf581838d60` passed all eight families at 50
cycles each: 400 family cycles and 1,962 app operations. Mutation-first versus
transition-first outcomes were A 45/5, B 47/3, C 46/4, D 43/7, E 35/15, and
F 49/1. G produced 150 expected post-conversion denials, while H passed all 50
additive/version contention cycles.

Authority attempts/successes were 550/0. Exact M30, wrong merge customer, and
wrong merge fingerprint were each 50/0. Terminal attempts/successes were 57/0
locked, 105/0 merged, and 150/0 converted. Lost updates, duplicates, version
mismatches, phantom items, partial merges, unauthorized item/version deltas,
deadlocks, timeouts, serialization errors, role leakage, authority
contamination, connection privilege leakage, unlabeled errors, SALE movements,
and external calls were all zero.

Final regression passed: pgTAP 16/16 and 526/526 on exclusive clean state;
functional DB 65/65 with double-submit and divergent hash at 20/20; existing
cart 20 cycles/3 scenarios; existing checkout 20 cycles/6 scenarios/220
executions with zero overselling. `npm test` retained only the known unrelated
Instagram assertion (707/708), typecheck passed, and lint retained zero errors
and five existing warnings. Offline build retained only the known Google Inter
blocker and recorded zero actual external requests.

Canonical S0/S1 remained equal at PostgreSQL 17.6, history 30/30, last
`20260907120000`, and business counts `0/0/0/0/0/0/0`. M29, M30, and harness
hashes remained frozen; M31 was absent; no second reset, canonical write,
network call, staging/production access, commit, or push occurred. All E1 Final
containers were removed. E1 status is COMPLETE and the evidence gate permits
a separately authorized E2 phase; E2 was not started.
