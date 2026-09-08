# M29-C-R4-A-R2 — expected-error isolation retry

Date: 2026-09-05. Local, strictly offline and disposable only.

## Canonical baseline

Before the change, canonical PostgreSQL at `127.0.0.1:15422` reported version
17.6, 28 persistent migrations, last version `20260905130000`, zero M29
`submit_native_checkout` objects and zero stores, carts or orders. There were 29
migration files. The candidate M29 SHA-256 was
`5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec`.

## R1 root cause and R2 remediation

R1 caught an expected `42501` denial in JavaScript while PostgreSQL kept the
transaction aborted. The next statement therefore returned `25P02`. R2 added a
harness-only reusable expected-error helper. It creates a unique savepoint, runs the
negative operation, always rolls back to and releases the savepoint, validates the
expected SQLSTATE and proves recovery with a subsequent `SELECT 1`. It fails closed
on unexpected success, a wrong SQLSTATE, recovery failure or `25P02` contamination.

Focused offline coverage proved the correct-code path, rollback-to-savepoint,
successful subsequent SQL, wrong-code rejection, explicit `25P02` rejection and
unexpected-success rejection. The runtime harness was extended to isolate app and
worker direct DML, cross-role activation, invalid activation and function ACL tests,
and to verify commit/rollback restoration and basic pool reuse.

## Fresh disposable retry

The retry used only the already-local
`public.ecr.aws/supabase/postgres:17.6.1.155` image with `--pull never`, a random
loopback port and tmpfs storage. Semantic readiness remained ahead of project
migrations, and the previous `realtime` initialization race did not recur. All 29
project migrations, including the exact M29 candidate, applied before ephemeral
login provisioning.

The authentic `persi_app_login` connected and proved no automatic execute authority.
The first isolated cross-role test then failed closed in the helper. PostgreSQL
denied `SET LOCAL ROLE persi_worker`, but the caught driver-level value did not expose
the SQLSTATE through the `.code` property consumed by the helper. The helper reported
`APP_ASSUME_WORKER:EXPECTED_ERROR_WRONG_SQLSTATE:NONE` and stopped. No following SQL
returned `25P02`; nevertheless, the expected `42501` could not be authenticated, so
the R2 gate is not approved.

Primary classification: `R4_A_R2_EXPECTED_ERROR_RECOVERY_DEFECT`. Migration 29 was
not modified and is not implicated by this failure. A future harness-only retry must
normalize Postgres.js error shapes without accepting absent or inferred SQLSTATEs,
add focused coverage for that real driver shape, then start from another clean
disposable container.

## Cleanup and invariance

The `finally` path closed the connections and removed the random container and its
tmpfs. No `persi-r4a-*` container remained. Canonical S1 equalled S0: PostgreSQL 17.6,
history 28, last `20260905130000`, zero M29 objects and zero stores, carts or orders.
Protected hashes P3-A, P3-B and migrations 26–29 remained exact. External requests,
remote access, reset, truncate, commit and push remained zero.
