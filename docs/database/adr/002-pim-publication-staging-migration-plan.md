# Plano de aplicação da migration de publicação PIM em staging (P3-C)

Status: **preparado, NÃO executado**. A aplicação da migration e a publicação de um canário real são **autorizações separadas** — este documento cobre apenas a primeira, e mesmo com ela concedida, nenhuma publicação real acontece automaticamente.

## Identidade

- Arquivo: `supabase/migrations/20260915030000_pim_publication_foundation.sql`
- SHA256 (bytes atuais): `44e0f4e4ca8a08ea87f13088537c00c5213cd0c3252787f05b9fd87e1f609ac2`
- Alvo: `persi-staging` (`vtrujmhhkmvjzfklzxip`) — **nunca produção**.

## Pré-requisitos (preflight)

1. `git status` limpo no branch de trabalho; `HEAD` registrado.
2. Recalcular o SHA256 do arquivo de migration nos bytes atuais e confirmar igual ao acima.
3. `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version` em staging → confirmar 38 migrations históricas presentes, a nova ausente (pending=1, extra=0).
4. Snapshot completo BEFORE das tabelas PIM (contagens: `product_attribute_values`, `attribute_values`, `pim_audit_log`, `pim_conflicts`, `pim_attribute_reviews`, `pim_attribute_decisions`, `attributes.status`) e fingerprint P1 (`b0e3bcb5d9...`).
5. Confirmar `pim_publication_batches`/`pim_attribute_publications` **ausentes** em staging antes de aplicar.

## Alvo esperado (o que a migration cria)

- `CREATE TYPE public.pim_publication_state` (`published`, `unpublished`).
- `CREATE TYPE public.pim_publication_batch_kind` (`canary`, `full`).
- `CREATE TYPE public.pim_publication_batch_status` (`active`, `rolled_back`).
- `CREATE TABLE public.pim_publication_batches` — PK `id` (uuid), CHECK de coerência rollback.
- `CREATE TABLE public.pim_attribute_publications` — PK composta `(product_id, attribute_id, attribute_value_id)`, FKs para `products`(cascade)/`attributes`(restrict)/`attribute_values`(restrict), CHECK de coerência estado/timestamp.
- Índices: `pim_attribute_publications_batch_idx`, `pim_attribute_publications_published_idx` (parcial, `where state='published'`).
- Trigger `pim_attribute_publications_set_updated_at` (reusa `public.set_updated_at()` já existente).
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` nas duas tabelas, **zero policies**.

## Estado esperado de RLS/grants pós-migration

Confirmado nesta rodada (P3-B) contra os defaults REAIS de staging: as 3 tabelas PIM já existentes (`pim_attribute_decisions`, `pim_attribute_reviews`, `pim_audit_log`) têm **zero privilégios** para `anon`/`authenticated` hoje, apesar de existir um `pg_default_acl` perigoso associado ao role `supabase_admin` (concederia DML completo a `anon`/`authenticated` em qualquer tabela nova). Isso prova que as migrations deste projeto são executadas como `postgres` (cujo próprio default ACL não concede nada a esses roles) — as duas tabelas novas devem herdar exatamente o mesmo comportamento seguro. **Verificação pós-migration obrigatória**: confirmar `has_table_privilege('anon', 'pim_attribute_publications', 'SELECT')=false` (e mesmo para `authenticated`/INSERT/UPDATE/DELETE) antes de considerar a migration bem-sucedida — não assumir, medir.

## Verificação pós-migration (read-only)

1. `\d public.pim_publication_batches` / `\d public.pim_attribute_publications` — schema bate exatamente com o arquivo.
2. Contagem das 2 novas tabelas = 0 linhas (migration é puramente schema, nunca escreve dado).
3. Repetir o snapshot do preflight (passo 4) — **toda tabela PIM source-truth deve estar byte-idêntica** (zero mudança em `product_attribute_values`, `attribute_values`, `pim_audit_log`, `pim_conflicts`, `pim_attribute_reviews`, `pim_attribute_decisions`, `attributes.status`, fingerprint P1).
4. `SELECT has_table_privilege('anon', 'public.pim_attribute_publications', 'SELECT')` e equivalentes para `authenticated`/INSERT/UPDATE/DELETE/TRUNCATE em ambas as tabelas → todos `false`.
5. `SELECT version FROM supabase_migrations.schema_migrations` → 39 migrations, a nova presente.

## Procedimento de emergência / rollback

- Se a migration falhar a meio caminho: a aplicação via `supabase migration up`/CLI é transacional por arquivo — uma falha faz rollback automático da migration inteira, sem estado parcial.
- Se, após aplicada com sucesso, for necessário reverter: `DROP TABLE public.pim_attribute_publications; DROP TABLE public.pim_publication_batches; DROP TYPE public.pim_publication_state; DROP TYPE public.pim_publication_batch_kind; DROP TYPE public.pim_publication_batch_status;` — seguro porque (a) nenhuma publicação real terá ocorrido ainda nesta fase (autorização separada), então as tabelas estarão vazias, e (b) nenhuma tabela PIM source-truth referencia estas duas por FK de volta (a relação é sempre destas duas → `products`/`attributes`/`attribute_values`, nunca o inverso).
- Nunca reverter apagando ou alterando `product_attribute_values`/`attribute_values`/`pim_audit_log` — o rollback desta migration não toca nenhuma tabela pré-existente.

## Autorizações necessárias (separadas, nesta ordem)

1. **Esta**: aplicar `20260915030000_pim_publication_foundation.sql` em staging (schema apenas, zero dado).
2. **Futura, distinta**: publicar um canário real (`publishBatch` com membros reais, `baselineReference` correto) — exige nova autorização explícita do usuário, independente da anterior.

Nenhuma das duas está autorizada por este documento.
