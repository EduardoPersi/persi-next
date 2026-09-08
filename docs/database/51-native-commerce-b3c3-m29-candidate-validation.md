# B.3-C3-P3-C-M29-A2/B2 — candidate validation

Candidate SHA-256: `5717b8da4658e1def1c10610955632df8ff694cdd54132905ef20b9e41713dec`.

## M29-C attempt

The complete candidate compiled successfully inside PostgreSQL 17.6 on 2026-09-05.
The subsequent disposable smoke harness stopped at its first assertion because it
called pgTAP `no_plan()` without its schema qualification (SQLSTATE `42883`). The
open transaction was rolled back automatically. S0 and S1 matched exactly and no M29
object persisted. Per the phase hard-stop rule, the harness was not corrected or
repeated and M29-C remains incomplete.

Data: 2026-09-05. Escopo: local e offline.

## Resultado

A candidata `20260905180000_native_checkout_atomic_submission.sql` foi criada sem
aplicação persistente. Ela contém hardening da autoridade do carrinho,
`orders.submission_request_hash`, helpers canônicos e `submit_native_checkout`.

PostgreSQL local 17.6 permaneceu em 28 migrations, último histórico
`20260905130000`. Consultas read-only confirmaram zero funções M29 e zero coluna
`submission_request_hash` persistentes. Nenhum reset, truncate, fixture, acesso remoto
ou rede externa foi usado.

## Contratos estáticos

- cart/item sem DML direto para app/worker e somente policies de SELECT;
- primitivas v2 owner-aware, definer, owner postgres e search path vazio;
- parent cart lock antes de mutação e item guard contra phantom/reparent;
- máquina de estados e versão fechadas;
- hash `c3-request-v1` recalculado sob locks e imutável no pedido;
- lock order checkout→cart→price→shipping→reservation→inventory→store;
- pedido pending, snapshots, evento inicial, link da reserva e cleanup PII;
- zero confirmação/movimento de estoque, pagamento ou integração externa;
- dinheiro, quantidades e versões em BIGINT; Drizzle em TypeScript `bigint`.

## Validação

- testes focados combinados: 39/39;
- testes estáticos M29 finais: 8/8;
- auditoria textual de PL/pgSQL, NULL, delimitadores e SQL dinâmico: passou;
- TypeScript `tsc --noEmit`: passou;
- ESLint: passou;
- `git diff --check`: passou.

Um parser PostgreSQL real não foi usado porque isso executaria DDL, ainda que em
rollback, e está reservado para M29-C. Esta fase não afirma compilação SQL nem
comportamento runtime das roles.

## Próximo gate

Arquivos de migration: 29. Histórico: 28. Objetos M29 persistentes: 0. Migration 29
canônica: não. Migration 30: não criada. O próximo passo permitido é somente o
transactional pre-apply M29-C após autorização explícita.
