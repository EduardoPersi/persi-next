# M29-R2 — price resolver contract remediation

Date: 2026-09-06. Local, strictly offline and disposable only.

## Price contract and correction

Canonical S0 was PostgreSQL 17.6 at `127.0.0.1:15422`, 29 migration files, history 28, last `20260905130000`, zero M29 objects and stores/carts/orders `0/0/0`.

The M27 resolver `resolve_checkout_authoritative_price(uuid,uuid,char(3),timestamptz)` returns, in order:

1. `price_id uuid`;
2. `list_amount_minor bigint`;
3. `sale_amount_minor bigint`;
4. `effective_amount_minor bigint`;
5. `valid_from timestamptz`;
6. `valid_to timestamptz`;
7. `sale_valid_from timestamptz`;
8. `sale_valid_to timestamptz`;
9. `currency char(3)`;
10. `price_fingerprint text`.

`list_amount_minor` is the regular/list amount and populates `checkout_session_items.unit_regular_amount_minor`. `effective_amount_minor` is the active sale amount when its sale window applies, otherwise the list amount, and populates `unit_effective_amount_minor`. Sale amount, validity bounds and currency are included in the unchanged canonical fingerprint. Checkout items have no separate unit-sale column.

M29 consumed only `p.price_id`, invalid `p.regular_amount_minor`, `p.effective_amount_minor` and `p.price_fingerprint`. The single objective R2 correction replaced `p.regular_amount_minor` with `p.list_amount_minor`. No resolver, fingerprint format, earlier migration or business behavior changed.

All other `%ROWTYPE`/record aliases in `submit_native_checkout` were checked against their source row types or return tables: checkout `s`, cart `c`, shipping quote `q`, price authority `authority`, order allocation `alloc`, checkout line `line`, inventory reservation `reservation`, created/existing order records and created item. No additional invalid field was identified during the authorized pre-runtime audit.

## Runtime proof and new blocker

A fresh PostgreSQL 17.6 disposable container used the local Supabase image, `--pull never`, loopback dynamic port and tmpfs. Migrations 1–29 applied. The resolver direct proof, executed with isolated fixture/admin authority because direct app execution is intentionally revoked, returned list 1000, sale null, effective 1000, BRL and a 64-character fingerprint.

Authentic `persi_app_login -> BEGIN -> SET LOCAL ROLE persi_app -> submit_native_checkout` crossed the complete price revalidation section with an unchanged authoritative price. The prior `p.regular_amount_minor` failure did not recur.

Execution then failed with a new M29 defect:

- SQLSTATE: `42704`;
- message: `constraint "orders_initial_event_required" does not exist`;
- statement: `SET CONSTRAINTS orders_initial_event_required,order_events_initial_exact IMMEDIATE`.

M26 creates constraint triggers with those trigger names, but they are not addressable constraint objects for this `SET CONSTRAINTS` statement. This new defect arose after runtime began, so the phase hard-stopped and did not correct it.

The failing submission transaction had already reached aggregate construction, but PostgreSQL rolled the entire transaction back. Persisted rejection side effects were zero: orders/items/addresses/events zero, reservation relink zero, new reservation movements zero, sale movements zero, on-hand delta zero and reserved delta zero. The original checkout reservation movement remained the expected pre-submission state.

Price increase, decrease, sale activation/expiry and assignment-change tests were not executed after the mandatory hard stop. Security/full regression tests were likewise not run beyond the static M29/harness suite, which passed 10/10 before runtime.

## Hashes and cleanup

- pre-R2 M29: `0b6f4e228024cd680765c4dec6f56a1df51d3585211e438e06af84d683762ca3`;
- post-R2 M29: `8b8575e7df28a8e6f676e7569b370e69cf2ca219273d789f9ec86c1d784fb8d8`.

Protected P3-A/P3-B/M26/M27/M28 hashes remained unchanged and migration count remained 29. The disposable container/tmpfs was removed. Canonical S1 remained history 28, last `20260905130000`, zero M29 objects and stores/carts/orders `0/0/0`.

External requests, staging/production access, canonical reset/truncate, M30, commit and push remained zero. The price correction is proven, but M29-R2 overall is blocked by the newly discovered M29 constraint-addressing defect. `SAFE_TO_RESTART_R4_C = NO`.

Historical follow-up: M29-R3 proved the catalog/search-path cause and remediated the constraint addressing without broadening deferred evaluation. See `66-native-commerce-m29-r3-initial-event-remediation.md`. This document preserves the original R2 hard-stop result.
