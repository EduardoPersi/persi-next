# M29-C-R4-B — transaction-pool role isolation

Date: 2026-09-05. Local, strictly offline and disposable only.

## Environment and scope

The stress harness reused the approved R4-A foundation: the already-local
`public.ecr.aws/supabase/postgres:17.6.1.155` image, `--pull never`, loopback-only
dynamic port 49214, tmpfs, semantic readiness and the exact 29-migration chain.
Readiness took 5,589 ms, with four probes, three consecutive successes and zero
regressions. M29 compiled and applied only inside the disposable database.

Postgres.js 3.4.9 ran with `prepare: false`. App and worker used separate authentic
credentials and separate pools. Pool sizes 1 and 2 covered the required sequential,
parallel and mixed paths; size 5 was included because the current application
connection configuration uses `max: 5`. Every protected operation used the same
transaction handle for `SET LOCAL ROLE` and subsequent SQL. No `RESET ROLE` or
session-level privilege activation was used.

## Stress results

- app transactions: 705;
- worker transactions: 705;
- app/worker successful commit paths: 400/400;
- app/worker controlled rollback paths: 100/100;
- app/worker expected database-error paths: 100/100;
- app/worker JavaScript exception paths: 100/100;
- app SECURITY DEFINER domain errors: 75;
- app/worker failed cross-role activations: 25/100;
- synthetic invalid-role checks: 10;
- total expected structured errors: 410/410 correct;
- missing/wrong SQLSTATE, unexpected success and `25P02`: zero.

Connection reuse was observed. The app and worker matrices each used nine unique
backend PIDs across 705 transactions, including intentional pool closure/recreation.
Fresh connections always began as their restricted login identity.

All leakage counters were zero: app role, worker role, app-to-worker,
worker-to-app and postgres privilege leakage. A protected callback executed after a
failed role activation zero times. Commit, rollback, expected SQL errors, function
errors and JavaScript exceptions all restored the login identity before pool reuse.

## Limitations and safety

This local result proves Postgres.js pooling, PostgreSQL transaction-scoped
`SET LOCAL ROLE` and physical connection reuse isolation. It does not reproduce or
prove Supavisor transaction pooling; `SUPAVISOR_SPECIFIC_VALIDATION = DEFERRED`.

The disposable container and tmpfs were removed. Canonical S1 equalled S0:
PostgreSQL 17.6, history 28, last `20260905130000`, zero M29 objects and zero stores,
carts or orders. Protected hashes remained exact. External requests, remote access,
reset, truncate, runtime activation, commit and push remained zero.
