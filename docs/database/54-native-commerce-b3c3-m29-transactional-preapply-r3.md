# B.3-C3-P3-C-M29-C-R3 — real-role pre-apply

> Follow-up: R4-P0 resolves the missing environment architecturally by preserving
> NOLOGIN privilege roles and designing separate restricted LOGIN session identities.
> See `55-native-database-runtime-identity-architecture.md`.

Date: 2026-09-05. Local and strict offline.

## Result

The canonical migration28 baseline, candidate hash and protected hashes matched.
The role-model preflight proved that authentic local application-role sessions are
not available:

- `persi_app`, `persi_worker`, `persi_readonly`, `anon` and `authenticated` are `NOLOGIN`;
- no `PERSI_APP_DATABASE_URL` or `PERSI_WORKER_DATABASE_URL` configuration exists;
- `postgres` is not superuser in this Supabase stack;
- memberships from `postgres` to app, worker and readonly have `SET=false`;
- therefore `postgres` cannot legitimately execute `SET ROLE persi_app` or worker.

No membership, role attribute, password, authentication rule or connection setting
was changed. An isolated clone would reproduce the same `NOLOGIN` roles and would not
create an authentic role session without one of those forbidden security mutations.
Strategies A and B are unavailable, and strategy C cannot satisfy the required real
role runtime gate.

R3 stopped before opening a disposable M29 transaction. The canonical database
remained at history 28, last `20260905130000`, with zero M29 objects and empty
commerce fixtures. Migration 29 remained unchanged at SHA-256
`5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec`.

Primary classification: `LOCAL_ROLE_ENVIRONMENT_MISSING`. This is not evidence of a
Migration 29 defect. M29-D remains unsafe until the architecture provides an approved
authentic execution mechanism for the technical roles or explicitly revises what
constitutes the runtime identity boundary.
