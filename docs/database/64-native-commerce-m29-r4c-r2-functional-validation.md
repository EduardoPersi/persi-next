# M29-C-R4-C-R2 — revised candidate full functional restart

Date: 2026-09-06. Local, strictly offline and disposable only.

## Result

R4-C-R2 hard-stopped during the first complete happy-path submission. The revised M29 candidate compiled and applied as migration 29 in a fresh PostgreSQL 17.6 disposable database. Authentic `persi_app_login -> BEGIN -> SET LOCAL ROLE persi_app` execution successfully created the cart, prepared the checkout, persisted temporary encrypted PII, reached `ready`, produced the canonical submission hash and entered `submit_native_checkout`.

Submission failed with SQLSTATE `42703` and message `column p.regular_amount_minor does not exist`.

The existing M27 resolver `resolve_checkout_authoritative_price(uuid,uuid,char(3),timestamptz)` returns `list_amount_minor`, not `regular_amount_minor`. M29 line 277 references the nonexistent result column while revalidating the checkout price snapshot. Classification: another M29 functional/schema-contract defect, not a harness, identity, fixture, Docker or environment failure.

Per the R4-C-R2 failure policy, M29 was not corrected and all later functional, authorization, TOCTOU, rollback and concurrency scenarios were stopped.

## Proven pre-failure state

- revised M29 hash matched `0b6f4e228024cd680765c4dec6f56a1df51d3585211e438e06af84d683762ca3` immediately before disposable apply;
- local image `public.ecr.aws/supabase/postgres:17.6.1.155`, `--pull never`, loopback dynamic port and tmpfs;
- semantic readiness: three consecutive successes, four attempts, zero regressions;
- migrations: 29/29 applied in the disposable database;
- synthetic guest fixture, no shipping required;
- checkout prepared status `validating`, then `ready`;
- checkout cart-version snapshot `1`; locked cart version `2`, proving the corrected `V -> V+1` contract;
- commercial authority used existing `storefront_retail` context;
- active reservation and its reservation movement existed before submission;
- no external provider call.

The failing statement ran inside the submission transaction before order-number allocation, order insertion, reservation linking, cart conversion or PII cleanup. PostgreSQL rolled that transaction back. Therefore submission created no order aggregate, no new inventory movement, no sale movement and no on-hand/reserved delta.

## Gates blocked by hard stop

Order aggregate/number/items/addresses/tax/event, conversion, cleanup, same/same and conflict idempotency, customer authorization, price/shipping/reservation mutation matrices, atomic rollback injection, all five 20-cycle concurrency suites, worker/public matrices and full regression were not executed and are not claimed as passed.

Schema-resolution tracking recorded one unexpected `42703`; `42883`, `42P01` and `42704` remained zero before the stop.

## Cleanup and canonical state

The disposable connection, container and tmpfs were removed. Canonical S1 remained PostgreSQL 17.6, history 28, last `20260905130000`, zero M29 persistent objects and stores/carts/orders `0/0/0`. M29 retained its candidate hash. No M30, canonical reset, truncate, staging/production access, external network call, commit or push occurred.

`SAFE_TO_REQUEST_M29_D_REBUILD` remains `NO`. A separately authorized offline remediation is required before another R4-C restart.

Historical follow-up: the resolver field mismatch was corrected in M29-R2. That focused runtime then crossed price revalidation and exposed a separate constraint-addressing defect, recorded in `65-native-commerce-m29-r2-price-contract-remediation.md`. This document remains the original R4-C-R2 failure record.
