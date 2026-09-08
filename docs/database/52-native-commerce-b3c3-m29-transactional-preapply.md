# B.3-C3-P3-C-M29-C — transactional pre-apply

## R3 chronology

R3 audited the real local role model before selecting a harness strategy. Both
`persi_app` and `persi_worker` are `NOLOGIN`; no role-specific local connection
configuration exists. Although `postgres` has membership records, both memberships
have `SET=false`, which explains R2's permission error. Creating login credentials or
changing memberships is explicitly forbidden. R3 therefore stopped before applying
M29 with classification `LOCAL_ROLE_ENVIRONMENT_MISSING`.

## R2 chronology

R2 installed pgTAP 1.3.3 transactionally in `extensions`, used only qualified
assertions, reapplied the complete unchanged candidate and passed 10 catalog/ACL
assertions. It stopped at `SET LOCAL ROLE persi_app` with SQLSTATE `42501`: the local
Supabase `postgres` login cannot assume that role. The open transaction rolled back
the migration, extension and fixtures. This is a harness defect, not a Migration 29
defect.

Date: 2026-09-05. Scope: local and strict offline.

## Result

The authorized candidate hash matched exactly. PostgreSQL 17.6 executed the complete
Migration 29 inside a transaction without migration compilation errors. Temporary
catalog inspection confirmed the M29 functions, triggers, policies, column,
constraint and ACL changes.

The focused smoke harness then failed before its assertions because `no_plan()` was
resolved without the pgTAP extension schema. PostgreSQL reported SQLSTATE `42883`,
function `no_plan() does not exist`, at the harness statement. This was a harness
qualification defect, not a Migration 29 compilation defect.

The psql session closed with the outer transaction open, causing automatic rollback.
No retry or correction was made because M29-C requires a hard stop after any SQL
failure.

## Rollback proof

S0 and S1 table counts were identical and all 15 relevant tables remained empty.
Migration history remained 28 with last version `20260905130000`. M29 functions and
`orders.submission_request_hash` were absent after rollback. Policy, function and
table-grant fingerprints matched S0 exactly.

Candidate hash after rollback:
`5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec`.

## Gate

M29 compilation: passed. Focused transactional smokes: not completed. M29-C: failed
closed/incomplete. Candidate revision: not indicated; the next authorized phase
should correct only the disposable harness by schema-qualifying pgTAP functions and
restart M29-C from its baseline. M29-D is not authorized.
