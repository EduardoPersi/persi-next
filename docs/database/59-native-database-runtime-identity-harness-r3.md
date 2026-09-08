# M29-C-R4-A-R3 — structured SQLSTATE normalization retry

Date: 2026-09-05. Local, strictly offline and disposable only.

## Baseline and driver evidence

Canonical S0 was PostgreSQL 17.6 at `127.0.0.1:15422`, 28 persistent
migrations, last `20260905130000`, zero M29 objects and zero stores, carts or
orders. The project contained 29 migration files and the M29 SHA-256 was
`5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec`.

The installed driver is `postgres` 3.4.9. Its local source maps PostgreSQL Error
Response field `C` to the own `code` property of `PostgresError`; the constructor
uses `Object.assign`, making that field enumerable. The transaction implementation
also exposes `tx.savepoint(...)` and preserves the original `PostgresError` when its
nested rollback encounters `25P02`.

## Strict normalizer and recovery

`extractPostgresSqlState` now accepts only an actual driver `PostgresError` whose own,
enumerable, non-accessor `code` value matches `^[0-9A-Z]{5}$`. It does not inspect
messages, stacks, arbitrary nested fields or recursively search properties. Node
network codes and unknown objects fail closed.

The expected-error helper now executes negative operations through the driver's
native savepoint scope, lets the server error escape that nested scope, validates its
structured SQLSTATE, and then proves the outer transaction remains usable with
`SELECT 1`. Unit fixtures cover structured `42501`, `25P02`, `P0002`, missing/wrong
types and lengths, lowercase, `ECONNREFUSED`, message-only codes and unknown nesting.

## Disposable retry result

The fresh retry used the already-local Supabase PostgreSQL image with `--pull never`,
a random loopback port and tmpfs. Semantic readiness passed and the `realtime` race
did not recur. Migrations 1–28 and the exact M29 applied successfully. Ephemeral app
and worker logins and memberships were provisioned.

The authentic app session had `session_user=current_user=persi_app_login` and no
automatic submit authority. Real `SET LOCAL ROLE persi_worker` and `SET LOCAL ROLE
postgres` denials were both extracted as structured `42501`, recovered through native
savepoints and followed by successful SQL. This confirms the R2 missing-code defect
and `25P02` contamination are resolved.

The next invalid-role test expected `42704`, but PostgreSQL 17 returned structured
`22023` for `SET LOCAL ROLE persi_nonexistent`. The normalizer correctly extracted
and rejected the mismatch. Primary classification: `R4_A_R3_HARNESS_DEFECT`. This is
an incorrect harness expectation, not a normalizer, readiness, role architecture or
Migration 29 defect. No automatic correction or retry was performed.

## Cleanup and invariance

The `finally` path removed the disposable container and tmpfs; no `persi-r4a-*`
container remained. Canonical S1 equalled S0 exactly. Protected hashes P3-A, P3-B and
migrations 26–29 remained unchanged. External requests, remote access, reset,
truncate, commit and push remained zero.
