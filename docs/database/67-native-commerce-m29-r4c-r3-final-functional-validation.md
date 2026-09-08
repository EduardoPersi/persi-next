# R4-C-R3 — final full atomic submission attempt

Date: 2026-09-06. Local, strictly offline and disposable only.

## Result

The exact M29 candidate `1cb4f4d50377270c999d87025774211d15c444bb15caae670101fa3166b44ee4` compiled and applied with migrations 1–29 in fresh PostgreSQL 17.6 disposable databases. The proven base matrix passed again through authentic `persi_app_login -> BEGIN -> SET LOCAL ROLE persi_app -> submit_native_checkout`.

Proven in this phase before expansion:

- pending order with one item, two addresses and exactly one initial event;
- order number allocated once and same/same retry did not advance it;
- divergent hash rejected with `23505 / CHECKOUT_IDEMPOTENCY_CONFLICT`;
- correct guest capability succeeded; wrong capability and UUID-only failed with `42501`;
- durable CPF decrypted server-side, temporary ciphertext was not reused and only the mask was reported;
- cart converted and add/set/remove/reactivation were rejected;
- checkout ended `order_created`, temporary PII was cleared;
- reservation remained active and linked exactly once;
- inventory stayed on-hand 2, reserved 1, reservation movements 1, sale movements 0;
- missing, duplicate and wrong initial-event negative tests remained rejected with zero residue;
- schema error guard remained zero in the completed base matrix.

## Harness hard stop

The expanded isolated-fixture factory then failed before customer/price/concurrency execution with application error `CHECKOUT_PII_INVALID`. Root cause: it passed an already canonical envelope back into `canonicalizeCheckoutPii`, including the output-only `schemaVersion` property, while that function intentionally accepts a strict raw-input shape without `schemaVersion`.

Classification: `R4_C_R3_HARNESS_DEFECT`, not a migration, database, identity or schema-contract defect. M29 was not modified. Per the explicit R4-C-R3 failure policy, the harness was not corrected in this phase and later matrices were not executed or claimed as passing.

The disposable container/tmpfs was removed. Canonical S1 remained history 28, last `20260905130000`, zero M29 objects and stores/carts/orders `0/0/0`. No M30, canonical reset/truncate, remote access, external request, commit or push occurred.

R4-C-R3 is incomplete. A narrowly authorized harness correction is required before resuming the remaining customer, price, shipping, reservation and concurrency matrices.

Historical follow-up: the exact PII lifecycle defect was corrected and proven in H1. The resumed matrix then hard-stopped on a separate unlabelled expected-domain-error containment problem in the expanded harness; see `68-native-commerce-m29-r4c-r3-h1-final-matrix.md`. This preserves the original harness-only failure record.
