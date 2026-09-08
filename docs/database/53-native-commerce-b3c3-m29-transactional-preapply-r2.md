# B.3-C3-P3-C-M29-C-R2 — transactional retry

Date: 2026-09-05. Local and strict offline.

The migration28 baseline and protected hashes matched. pgTAP was absent from
`pg_extension`; package 1.3.3 and schema `extensions` were available. The harness
created the extension inside the outer transaction and called only schema-qualified
pgTAP functions, without changing any search path.

The complete unchanged Migration 29 compiled. Ten catalog/ACL assertions passed:
SELECT-only policies, app/worker DML revocation, submit/cart ACLs, secure definers and
legacy-overload removal. After synthetic fixtures were created, the first role smoke
failed at `SET LOCAL ROLE persi_app` (SQLSTATE `42501`). The local `postgres` login is
not authorized to assume the application role.

The harness was not corrected or rerun. Session closure rolled back all DDL,
extension and fixtures. S1 confirmed history 28, last `20260905130000`, empty relevant
tables, zero M29 objects and no pgTAP extension. Candidate hash remained
`5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec`.

Classification: `HARNESS_DEFECT`; `MIGRATION29_DEFECT = NO`. Runtime role/cart smokes
remain incomplete. M29-D is unsafe until a separately authorized retry uses distinct
local role connections or another non-escalating role-test strategy.
