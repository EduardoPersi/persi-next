# M29-C-R4-C — full real-role atomic submission validation

Date: 2026-09-05. Local, offline and disposable only.

## Outcome

R4-C stopped at the first functional gate. The exact unchanged migration 29 applied successfully to a fresh disposable PostgreSQL 17.6 database, but its authentic `persi_app_login -> SET LOCAL ROLE persi_app` cart creation path failed before checkout preparation.

The database returned SQLSTATE `42703`, `column s.currency does not exist`, from `public.create_native_cart`. The canonical `public.stores` contract defines `default_currency`; it does not define `currency`. Migration 29 line 67 queries `s.currency = p_currency`.

Classification: M29 functional defect. This is not a harness, role, Docker, Supabase bootstrap, fixture-data or environment failure. No migration was changed automatically.

## Reproduction boundary

- image: `public.ecr.aws/supabase/postgres:17.6.1.155` already present locally;
- pull policy: `--pull never`;
- bind: loopback-only dynamic port;
- storage: tmpfs;
- readiness: semantic readiness with consecutive successful probes;
- migrations: exact ordered chain 1–29;
- M29 SHA-256: `5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec`;
- runtime login: authentic `persi_app_login`, `NOINHERIT`, `SET TRUE` membership in `persi_app`;
- runtime activation: `SET LOCAL ROLE persi_app` inside the same Postgres.js transaction;
- fixture: synthetic store, price authority, active product/variant/price and inventory only;
- external requests: zero.

The first fixture attempt was rejected before runtime validation because an active product was inserted before its active variant. The harness was corrected to insert the product as draft, insert the variant, then activate the product. A fresh disposable database was built. The second attempt reached the authentic M29 runtime function and produced the structural `42703` failure above.

## Gates not executed after hard stop

The happy-path order aggregate, same-hash retry, conflicting-hash retry, customer ownership path, TOCTOU matrices, rollback-after-number allocation, 20-cycle race suites, deadlock/timeout audit, worker/public denial checks and public projections were not executed. They are neither passed nor failed; they are blocked by the first functional runtime defect.

The previously completed R4-A and R4-B identity/isolation evidence remains valid, but it does not imply R4-C functional approval. Supavisor-specific validation remains deferred.

## Safety and cleanup

The disposable container and tmpfs were removed. Read-only post-run verification of canonical S1 returned migration history 28, zero stores, zero carts, zero orders and zero `submit_native_checkout` objects. No reset, truncate, staging access, production access, external integration, commit or push occurred.

Next permitted action is an offline M29 corrective-design phase with explicit authorization. `SAFE_TO_REQUEST_M29_D_REBUILD` remains `NO`.

Historical follow-up: the store-currency mismatch and related objective M29 contract defects were remediated offline in M29-R1. See `63-native-commerce-m29-r1-functional-remediation.md`. This section preserves the original R4-C failure record.
