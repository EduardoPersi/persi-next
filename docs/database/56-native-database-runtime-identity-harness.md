# M29-C-R4-A — disposable runtime identity harness

> R4-A-R1 fixed the Supabase bootstrap race with semantic readiness and reached all
> 29 migrations plus authentic login sessions. It then exposed a separate harness
> transaction error (`25P02`) caused by continuing after an expected denied DML
> without a savepoint. See document 57.
>
> R4-A-R2 added savepoint-based expected-error recovery and its offline tests passed.
> A fresh disposable retry again reached all 29 migrations, but stopped at the first
> cross-role denial because the caught driver error did not expose its SQLSTATE in the
> field consumed by the helper. The helper failed closed with `actualCode = NONE`; no
> `25P02` contamination occurred. See document 58.
>
> R4-A-R3 adopted Postgres.js native savepoints and strict `PostgresError.code`
> normalization. Real app-to-worker and app-to-postgres denials were extracted as
> `42501` with zero transaction contamination. The retry then failed closed because
> PostgreSQL 17 reports an unknown `SET LOCAL ROLE` target as `22023`, while the
> harness expected `42704`. See document 59.
>
> R4-A-R4 changed only the synthetic nonexistent-role expectation to the evidenced
> PostgreSQL 17.6 SQLSTATE `22023`. A new disposable run completed all 29 migrations,
> both authentic login matrices, 18/18 expected errors, SECURITY DEFINER sanity,
> commit/rollback restoration and basic pool reuse with zero leakage or `25P02`.
> R4-A is complete. See document 60.
>
> R4-B subsequently stressed separate app and worker Postgres.js pools at sizes 1, 2
> and 5. Across 1,410 protected transactions and 410 expected database errors there
> was zero role leakage, privilege escalation, SQLSTATE mismatch or `25P02`.
> See document 61.

Date: 2026-09-05. Mode: local, offline and disposable only.

## Implementation

The harness `scripts/database/runtime-identity-disposable.mjs` uses the already-local
`public.ecr.aws/supabase/postgres:17.6.1.155` image with `--pull never`, a random
loopback port and container-local tmpfs storage. It generates separate admin/app/worker
credentials in process memory, never emits them, applies the migration chain, creates
restricted login identities and uses Postgres.js real TCP sessions to test
transaction-scoped role activation. Cleanup is in `finally` and targets only the
random container created by the process.

## Attempt result

Static harness tests passed 4/4. The disposable PostgreSQL became reachable, but the
schema bootstrap stopped before M29 with PostgreSQL error `permission denied for
schema realtime` after a notice that `extensions` already existed. No project
migration contains a `realtime` reference. The evidence indicates the readiness probe
allowed project migrations to begin while the Supabase image was still completing its
own initialization, producing a bootstrap race/ownership conflict.

The failure occurred before ephemeral login provisioning or authentic role tests.
M29 was not reached and was not modified. Primary classification:
`R4_A_DISPOSABLE_BOOTSTRAP_DEFECT`.

## Cleanup and canonical invariance

The `finally` cleanup removed the disposable container and tmpfs. Docker inventory
showed no remaining `persi-r4a-*` container. The canonical database remained at
history 28, last `20260905130000`, with zero M29 objects and empty commerce fixtures.
Candidate SHA-256 remained
`5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec`.

The next authorized revision should strengthen disposable readiness by waiting for the
Supabase image initialization to finish completely, then rerun R4-A from a clean
container. It must not alter Migration 29 or canonical PostgreSQL.
