# R4-C-R3-H1 — harness-only PII fix and resumed matrix

Date: 2026-09-06. Local, strictly offline and disposable only.

## Authorized H1 correction

The prior factory passed an already canonical checkout PII envelope, including output-only `schemaVersion`, back to the strict raw-input canonicalizer. The harness now has `createRawCheckoutPiiFixture()`, which returns only raw input fields. Each fixture follows raw input -> `canonicalizeCheckoutPii` exactly once -> encryption/persistence.

A focused test passed and proved both sides: raw input canonicalizes successfully, while an already canonical envelope continues to fail with `CHECKOUT_PII_INVALID`. No canonicalizer, crypto, migration or production runtime behavior changed.

## Resume result and hard stop

The H1 test passed. A fresh disposable PostgreSQL 17.6 environment then applied migrations 1–29 with the unchanged M29 hash `1cb4f4d50377270c999d87025774211d15c444bb15caae670101fa3166b44ee4`.

During the expanded customer/price/concurrency block, a `23514 / CHECKOUT_PRICE_STALE` raised from `submit_native_checkout` escaped the harness instead of being attributed to a labelled matrix case. That domain error is expected for several price-negative scenarios, but the current harness output did not preserve the caller/case label, so it is not safe to infer which scenario produced it or to classify it as an M29 defect.

Classification: `R4_C_R3_H1_ADDITIONAL_HARNESS_CONTROL_FLOW_DEFECT`. It is not a schema-resolution error and there is no evidence of an M29 or production-code defect. The protocol authorized only the known PII fixture correction and explicitly required hard stop for another harness-only issue. No additional instrumentation or retry was added.

The previously proven base happy path, idempotency, guest authorization, durable tax, terminal cart, event invariants and measured inventory boundary remain valid evidence, but the newly resumed customer/price results and all later shipping/reservation/concurrency results are not claimed.

The disposable container/tmpfs was removed. Canonical S1 remained PostgreSQL 17.6, history 28, last `20260905130000`, zero M29 objects and stores/carts/orders `0/0/0`. M29 and migrations 1–28 were unchanged. External requests, staging/production access, canonical reset/truncate, M30, commit and push remained zero.
