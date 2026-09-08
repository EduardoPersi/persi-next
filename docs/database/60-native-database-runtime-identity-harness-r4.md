# M29-C-R4-A-R4 — final disposable runtime identity result

Date: 2026-09-05. Local, strictly offline and disposable only.

## Surgical correction

R3 obtained structured PostgreSQL 17.6 evidence that `SET LOCAL ROLE` with the
deliberately nonexistent role returns SQLSTATE `22023` through Postgres.js 3.4.9
`PostgresError.code`. R4 changed only the app and worker synthetic invalid-role
expectations from `42704` to `22023`. Cross-role attempts against existing
`persi_worker`, `persi_app` and `postgres` remained strictly `42501`. A focused
static assertion prevents those contracts from being conflated.

## Disposable execution

The run used the already-local `public.ecr.aws/supabase/postgres:17.6.1.155` image
with `--pull never`, random loopback port 65506 and tmpfs storage. Semantic readiness
completed in 6,619 ms after five probes, three consecutive successes and zero
regressions. The previous `realtime` initialization race did not recur.

All 29 migrations applied in order. The exact M29 candidate compiled and applied with
SHA-256 `5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec`.
Ephemeral app and worker logins had no superuser, bypass-RLS, create-role,
create-database or replication attributes. Memberships were exactly `ADMIN FALSE`,
`INHERIT FALSE`, `SET TRUE` with no cross-membership.

Both authentic TCP sessions proved restricted login identity before activation,
transaction-scoped activation of their intended NOLOGIN role, cross-role isolation,
direct DML restrictions, app-only M29 function execution, SECURITY DEFINER domain
entry, and restoration after commit and rollback. Basic app and worker pool reuse had
zero role leakage. All 18 expected PostgreSQL failures produced their exact structured
SQLSTATE: 18 correct, zero missing, zero wrong, zero `25P02` contaminations and zero
unexpected successes.

## Cleanup and canonical invariance

The `finally` path closed every connection and removed the random container and its
tmpfs. No `persi-r4a-*` container remained. Canonical S1 equalled S0: PostgreSQL 17.6,
history 28, last `20260905130000`, zero M29 objects and zero stores, carts or orders.
Protected hashes P3-A, P3-B and migrations 26–29 remained exact. No external request,
remote access, reset, truncate, runtime activation, commit or push occurred.

R4-A is complete and the evidence supports `SAFE_TO_START_R4_B = YES`; R4-B was not
started and still requires explicit authorization.
