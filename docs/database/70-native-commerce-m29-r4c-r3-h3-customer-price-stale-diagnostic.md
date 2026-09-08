# M29 R4-C-R3-H3 — customer price-stale diagnostic

Date: 2026-09-06
Mode: local, strict offline, disposable PostgreSQL 17.6 only

## Result

H3 reproduced `23514 / CHECKOUT_PRICE_STALE` and classified it as
`M29_FUNCTIONAL_DEFECT`. No production code, migration, canonical database,
staging, or production environment was changed.

The authoritative M29 SHA-256 remained:

`1cb4f4d50377270c999d87025774211d15c444bb15caae670101fa3166b44ee4`

## Objective evidence

The H2 broad harness failed at `CUSTOMER_CONTROL_VALID`. Immediately before
submission, a direct administrative diagnostic proved that the checkout
snapshot and current resolver output had the same:

- assignment ID and version;
- price-list ID;
- price ID;
- list amount (`1000`);
- effective amount (`1000`);
- canonical price fingerprint.

All assignment and price mismatch flags were false. The runtime submission,
executed through `persi_app_login -> BEGIN -> SET LOCAL ROLE persi_app`, still
failed inside the M29 price predicate because the nested call to
`resolve_checkout_authoritative_price` raised `CHECKOUT_PRICE_STALE` at its
`not found` branch.

Session inspection showed one idle `persi_app_login` connection with no open
transaction. A one-day price-validity window produced the same failure, ruling
out an edge validity window and an abandoned transaction snapshot.

## Minimal controls

With guest and customer checkouts sharing the same pre-existing commercial
authority, both submission orders passed, including guest-first and
customer-second execution.

The failure was then reproduced minimally when:

1. a guest submission completed successfully;
2. a new store, assignment, price list, product, variant, price, and inventory
   fixture were created;
3. the customer checkout was prepared and marked ready against that new
   authority;
4. the direct resolver matched the snapshot exactly;
5. the M29 submission returned `23514 / CHECKOUT_PRICE_STALE` from the nested
   resolver's `not found` branch.

This establishes that ownership is not the cause. The first relevant
divergence is the introduction of a different commercial authority after a
prior execution of `submit_native_checkout`. The precise PostgreSQL internal
plan mechanism was not modified or speculatively corrected in H3.

## Stale predicate attribution

| Predicate | Result immediately before submission |
| --- | --- |
| Assignment ID mismatch | No |
| Assignment version mismatch | No |
| Assignment price-list mismatch | No |
| Price ID mismatch | No |
| List/regular amount mismatch | No |
| Effective amount mismatch | No |
| Fingerprint mismatch | No |
| Resolver `not found` inside M29 | Yes |

## Classification and stop

Classification: `M29_FUNCTIONAL_DEFECT`.

H3 authorization explicitly forbids correcting M29 or production behavior for
this classification. Therefore customer negative authorization tests, the
price mini-matrix, focused regression, and the remaining R4-C matrix were not
run. H3 stopped without creating M30 or changing M29.

The H2 completion document (`doc69`) did not exist because H2 hard-stopped; it
was not fabricated or backfilled.
