# M29-C-R4-P0 — native database runtime identity architecture

> R4-A implementation attempt: the disposable container and cleanup model worked,
> but schema bootstrap raced the Supabase image initialization and stopped before M29
> with `permission denied for schema realtime`. See document 56.

Date: 2026-09-05. Status: read-only design; no database provisioning performed.

## Decision

Adopt separate session identities and privilege identities:

```text
persi_app_login    -- LOGIN, no table grants
  └─ membership persi_app: INHERIT FALSE, SET TRUE

persi_worker_login -- LOGIN, no table grants
  └─ membership persi_worker: INHERIT FALSE, SET TRUE
```

`persi_app` and `persi_worker` remain `NOLOGIN`. The two login roles must be
`NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION`, receive CONNECT and
only the minimum namespace access needed to activate their role, and have no direct
commerce table privileges. App and worker receive no cross-membership.

## Current evidence

Migration `20260901120000_shipping_core.sql` creates the three Persi privilege roles
as `NOLOGIN`. There is no explicit repository `GRANT persi_* TO postgres`. PostgreSQL
17 created creator-membership records when the non-superuser `postgres` role used
`CREATEROLE`; these records have ADMIN but `SET=false`, so membership does not imply
authorization for `SET ROLE`. Current app, worker, readonly, anon and authenticated
roles cannot log in. No app/worker connection variable is configured.

The server DAL is `lib/db/connection.ts`: server-only Drizzle over Postgres.js, one
generic `DATABASE_URL`, pool maximum 5, idle timeout 20 seconds, connection timeout 10
seconds and `prepare:false`. Staging documentation intends the Supavisor transaction
pooler for runtime and direct connections only for migrations. The current URL does
not prove a restricted runtime identity; normal application use must not retain an
owner connection.

## Options

- Make `persi_app` LOGIN: rejected; couples credential and privilege identity.
- One shared login for app and worker: rejected; expands blast radius and weakens audit.
- Separate app/worker logins: selected; least privilege and independent rotation.
- Automatic inherited privileges: rejected; login is useful before explicit activation.
- Owner/superuser runtime: rejected; bypasses the intended boundary and RLS.

No readonly login is needed until an operational consumer is identified.

## Activation and pooling

Use an explicit Postgres.js transaction for every native commerce operation:

```text
connect as persi_app_login
BEGIN
SET LOCAL ROLE persi_app
call/query approved commerce surface
COMMIT or ROLLBACK
```

Workers use the identical pattern with their own credential and `persi_worker`.
`SET LOCAL ROLE` is transaction-scoped and automatically disappears at transaction
end, which is compatible with transaction pooling and prevents role leakage on pool
reuse. Session-level `SET ROLE` is prohibited. Activation failure aborts the operation;
the minimally privileged login must never continue as a fallback.

In Postgres.js this belongs inside `sql.begin(...)` on its pinned transaction
connection, with `prepare:false`. Drizzle operations that need the effective role must
use that same transaction handle. A generic cached Drizzle object must not issue
privileged native operations outside this boundary.

## SECURITY DEFINER and RLS

Effective chain: restricted login → `SET LOCAL ROLE persi_app` → function EXECUTE →
M29 `SECURITY DEFINER` owner `postgres`. The caller receives only the behavior encoded
by that function, not generic postgres privileges. Empty function search paths and
fully qualified objects remain mandatory. Direct cart/order DML stays denied.

RLS evaluates ordinary SQL as the effective app/worker role. Definer functions run
with their owner authority, so their narrow checks are the security boundary. Login
roles must never be superuser or BYPASSRLS. Browser roles remain outside this chain.

## Provisioning and secrets

Login roles and passwords are infrastructure/secret provisioning, not commerce schema
migrations. Migration 29 must not reference environment-specific login names or
contain credentials; migration 30 is unnecessary. Provision each environment through
an audited bootstrap/admin channel, generate strong random credentials outside SQL
history, store them server-only, never log them, and rotate app/worker independently.

Recommended variables: `PERSI_APP_DATABASE_URL` and `PERSI_WORKER_DATABASE_URL`.
`DIRECT_URL` remains migration-only. Staging and production must use distinct secrets;
the browser receives none.

## Local validation architecture

R4-A should create an isolated disposable database/container from already-local
assets. Inside that disposable scope only, bootstrap random process-memory login
credentials and memberships with `INHERIT FALSE, SET TRUE`; never alter canonical
roles. R4-B proves session/current role, app-worker separation, escalation denial and
zero pool leakage. Cleanup drops only the disposable environment and verifies the
canonical database remains migration28. R4-C then reruns M29-C real-role smokes.

Tests must prove app cannot set worker, worker cannot set app, neither can set postgres,
create/alter roles or bypass RLS, and a reused pooled connection has reverted to its
minimal login identity after every commit/rollback.

## Sequence

1. R4-A: implement disposable identity bootstrap/harness only.
2. R4-B: validate authentication, isolation and transaction-pool leakage.
3. R4-C: complete real-role M29-C smokes.
4. M29-D: one separately authorized canonical rebuild.
5. E1: cart concurrency; E2: submission concurrency; F: full P3-C.

M29 change required: no. Architecture blocker: none at design level.
