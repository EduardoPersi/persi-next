# Incremental sync e search parity — Fase F.2

## Architecture

Woo continua autoridade. Eventos e reconciliação são apenas sinais: o worker sempre faz GET
do estado atual no Woo e importa um aggregate em uma transação. Não existe PostgreSQL → Woo,
dual write ou cutover. O site continua usando Woo e uma falha do sync não participa da resposta.

## Change sources discovered

As alterações podem nascer no Woo Admin, Olist/ERP → Woo, REST API e no plugin Persi
Catalog/PIM. Estoque, preço, promoção, categoria, marca, mídia, atributos e GTIN podem mudar
por caminhos distintos. Por isso webhook isolado não é suficiente; polling/reconciliação é o
safety net. Nenhum webhook remoto foi configurado nesta fase.

## Incremental sync, inbox e retry

`integration_inbox` guarda apenas identidade do sinal, hash opcional e metadados sanitizados.
A unique `(source, external_event_id)` deduplica. Workers usam `FOR UPDATE SKIP LOCKED`,
tentativas limitadas a seis, exponential backoff com jitter e dead-letter para erro permanente.
`integration_checkpoints` persiste cursor. A reconciliação compara `date_modified_gmt` por
`external_mapping.source_changed_at`, evitando que um cursor global esconda um item antigo.
Eventos fora de ordem nunca aplicam payload antigo: fazem nova leitura oficial.

O importador E.6 foi reutilizado. Create/update/no-op, preço HALF UP, sale dates, GTIN,
categorias, marca, mídia, PIM, inventory snapshot e mappings compartilham as mesmas regras.
Preço alterado grava `price_history`; no-op não grava histórico. Snapshot abaixo de reserved é
rejeitado como `INVENTORY_RESERVED_CONFLICT`; reservas e ledger não são liberados ou forjados.
Remoção/404 fica bloqueada como `ARCHIVE_POLICY_UNPROVEN`, pois a regra comercial não está
comprovada; não há hard delete.

## Staging and convergence

Foram processados 100 aggregates controlados: 99 no-op, 1 update, zero conflito/falha/retry;
sync p50/p95 835/982 ms. O checkpoint subsequente processou um sinal. A auditoria detectou
dois stocks alterados (`25125`, `16323`), ambos reconciliados: 2 updates, p50/p95 982/1.035 ms.
Convergência `inbox.received_at → processed_at`: p50 3.397 ms, p95 4.393 ms, máximo 4.393 ms.
A idade do `date_modified_gmt` foi registrada separadamente e não foi confundida com latência.

Após convergência, 3.080 produtos comparados: Critical/High/Medium/Low = 0/0/0/0. O backlog
de versões antigas é processável em lotes de 100 e não representa divergência de aggregate.

## Search architecture, synonyms e golden set

A normalização compartilhada preserva `/`, polegadas, mm, hífen, acentos e espaços. O ranking
é explícito: SKU exato, GTIN exato, nome exato/prefixo, marca, categoria/PIM, sinônimos e fuzzy.
Sinônimos existentes foram preservados e o alias comercial `esquenta pinto` foi incluído; ele é
testado na expansão, mas não integra o golden remoto porque o catálogo atual não contém uma
lâmpada correspondente.

`catalog_search_documents` é server-only, RLS, sem policies públicas, contém somente texto
normalizado necessário e é atualizado dentro do aggregate sync. Usa btree, `unaccent` e
`pg_trgm`. O golden set versionado tem 14 casos e passou 14/14: SKU, GTIN, nome, marca,
cor, `disjuntor`, `3/4`, `cano`, `20 mm`, `32mm`, `16mm x 1/2"`, sinônimos e typo.

Busca quente: p50 67,2 ms e p95 267,0 ms no golden; no corpus comparativo F.1, p50 28,7 ms
e p95 43,0 ms. `disjuntor`, `3/4` e `cano` passaram por critérios explícitos de relevância,
sem exigir identidade cega da ordem Woo.

## Missing Woo semantics

Ratings/review summary, popularity/featured, purchasable/backorders, tags, free-shipping,
imagens administrativas de categoria/marca e parte dos filtros Store API são usados em algum
ponto do frontend e continuam blockers de cutover geral. Reviews completas e HTML comercial
calculado não foram replicados. O checkout continua autoritativo no Woo.

## Security, migrations and tests

Migrations F.2: `20260824120000_incremental_sync.sql`,
`20260824120100_catalog_search_documents.sql` e
`20260824120200_catalog_search_fuzzy_threshold.sql` e
`20260824120300_search_document_default_variant.sql`. Rebuild local completo passou. Staging:
11 migrations, 25/25 tabelas com RLS, zero policies, inbox 103 processados, zero pending,
zero dead-letter e 3.080/3.080 search documents. Credenciais são server-only e logs não têm
payload, PII ou secrets.

## Risks and recommendation

Webhooks ainda não foram configurados; o polling deve ser agendado somente após definição
operacional. O backlog de `source_changed_at` legado deve ser drenado em lotes. A semântica de
archive precisa de decisão comercial e os campos Woo ausentes impedem canary geral. Apesar de
sync e busca aprovados tecnicamente, não se recomenda canary até fechar esses blockers e operar
o worker/reconciliation continuamente. Nenhum canary ou cutover foi executado.
# Atualização F.3

O inbox ganhou lease recovery de 5 minutos e foi validado com dois workers e crash simulado. `source_changed_at` chegou a 100%, backlog e dead-letter ficaram zerados. Webhook e schedules foram preparados, mas não configurados/ativados. Golden permaneceu 14/14; “cano” mantém melhoria de ranking como backlog seguro.
