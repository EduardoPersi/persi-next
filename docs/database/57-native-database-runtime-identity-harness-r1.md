# M29-C-R4-A-R1 — bootstrap readiness retry

Date: 2026-09-05. Local, offline and disposable only.

## Readiness remediation

The local Supabase image healthcheck is only `pg_isready`; it can succeed while the
entrypoint is still initializing schemas and grants. The R1 harness now uses this
state machine:

```text
CONTAINER_CREATED → POSTGRES_ACCEPTING_CONNECTIONS → SUPABASE_BOOTSTRAP_READY
→ PROJECT_MIGRATION_PREFLIGHT → PROJECT_MIGRATIONS_ALLOWED
```

`SUPABASE_BOOTSTRAP_READY` requires the image log marker `PostgreSQL init process
complete; ready for start up.` plus a read-only SQL probe for PostgreSQL 17,
`realtime`, `extensions`, `supabase_admin` and `authenticator`. Three consecutive
successful probes at 500 ms intervals are required; a failure resets the counter.
Timeout is 90 seconds. No fixed sleep or global search-path change is used.

Unit tests proved that pg readiness alone is insufficient, failures keep waiting,
regressions reset stability, consecutive success becomes ready, timeout fails closed,
diagnostics redact secrets and migrations are gated after semantic readiness.

## Retry result

The original `realtime` race did not recur. The actual 29 migration files, including
the exact M29 candidate, applied successfully in the disposable database. Ephemeral
login roles were provisioned and the authentic app connection reached its
transaction-scoped role tests.

The test then intentionally attempted denied direct DML inside a Postgres.js
transaction. PostgreSQL correctly rejected it, but the harness caught the JavaScript
error without rolling back to a SQL savepoint. The transaction remained aborted, so
the following approved SECURITY DEFINER sanity call returned SQLSTATE `25P02`
(`in_failed_sql_transaction`) instead of the expected `P0002`.

Primary classification: `R4_A_R1_HARNESS_DEFECT`. This is neither a migration
compilation defect nor evidence that the security boundary failed. A future retry
must isolate every expected SQL failure with a savepoint or separate transaction.

## Cleanup

The `finally` block closed pools and removed the random container/tmpfs. No
`persi-r4a-*` resource remained. Canonical PostgreSQL stayed at history 28, last
`20260905130000`, with zero M29 objects and empty commerce fixtures. M29 SHA-256
remained `5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec`.
