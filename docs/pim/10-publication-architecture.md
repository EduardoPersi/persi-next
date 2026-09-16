# PIM P.3-A — arquitetura de publicação (fundação)

## Problema

A auditoria read-only da A3.5E-P2-X encontrou que `attributes.status` (`draft`/`active`/`inactive`/`archived`, filtrado hoje em `services/catalog/postgres.ts`) é o único sinal de publicação existente, e sua granularidade é o **atributo inteiro**: ativar `material` publica esse atributo para todos os produtos de uma vez. Não existe forma de publicar "produto A / material" sem também publicar "produto A / comprimento" ou "produto B / material". Também não existe ledger de publicação, nem mecanismo de rollback/unpublish, nem publicação por `product_attribute_values` individual.

O storefront real hoje **não lê** `product_attribute_values` para a resposta pública — `services/catalog/productShadow.ts` só usa essa leitura para comparação em background (shadow), sempre retornando o resultado oficial do WooCommerce ao usuário.

## Três conceitos, nunca conflatados

- **PERSISTED** — a linha existe em `product_attribute_values`. Não implica elegibilidade nem publicação.
- **ELIGIBLE** — a associação passou pelos gates semânticos/humanos (`lib/pim/publication-eligibility.ts`). Não implica publicação.
- **PUBLISHED** — existe uma decisão explícita de publicação, vigente, para aquela identidade exata (`pim_attribute_publications.state='published'`).

## Granularidade

A unidade mínima de publicação é a tripla `product_id + attribute_id + attribute_value_id` — nunca SKU, nunca atributo inteiro implicitamente. `pim_attribute_publications` tem essa tripla como chave primária.

## Schema (`supabase/migrations/20260915030000_pim_publication_foundation.sql`)

- `pim_publication_batches`: identidade de um lote (canário ou full), com `member_fingerprint` (sha256 determinístico e independente de ordem da membership) para permitir reenvio idempotente do mesmo lote sem duplicar, e rejeição determinística de reuso do mesmo `id` com membership diferente. `status` (`active`/`rolled_back`) mais `rolled_back_at`/`rolled_back_by`.
- `pim_attribute_publications`: tabela de **estado atual** (não um log de eventos) — uma linha por tripla, com `state` (`published`/`unpublished`) alternado in-place, `batch_id` apontando para o lote que mais recentemente a tocou, `published_at`/`unpublished_at` coerentes com `state` via CHECK.

### Estado atual vs. histórico de eventos

Optamos por **current-state table + `pim_audit_log` existente**, não um ledger dedicado novo. Toda escrita desta fase do projeto (`ATTRIBUTE_BACKFILLED`, `ATTRIBUTE_REMEDIATION_REMOVED`, `ATTRIBUTE_DECISION_RECORDED`, ...) já usa exclusivamente `pim_audit_log` para responder quem/quando/por quê — introduzir um segundo mecanismo de auditoria só para publicação duplicaria infraestrutura já testada e index­ada (`entity_type,entity_id,created_at` e `product_id,created_at`). `publishBatch`/`unpublishBatch` gravam `ATTRIBUTE_PUBLISHED`/`ATTRIBUTE_UNPUBLISHED` com o `batch_id` embutido no campo `reason`, seguindo a mesma convenção usada para SHA256 de artefatos nas rodadas P2.

RLS habilitada em ambas as tabelas, **zero policies** — mesmo padrão de `pim_attribute_reviews`/`pim_attribute_decisions`/`pim_audit_log`: `anon`/`authenticated` são negados por padrão (fail-closed); somente a conexão server-side (`getDatabase()`, a mesma usada por todo `lib/pim/*.ts`) lê/escreve.

## Eligibility gate (`lib/pim/publication-eligibility.ts`)

`evaluatePublicationEligibility(db, {productId, attributeId, attributeValueId})` reavalia, sempre a fresco (nunca cacheado), os gates: identidade existe exatamente; `attribute_value_id` resolve; atributo é um dos 4 suportados (`material`/`conexao`/`comprimento`/`volume`); `TEMPLATE_PLACEHOLDER_TEXT` (única classe de falso-positivo persistido confirmada em A3.5E-P2, escopo `material`); decisão humana `rejected`; conflito **aberto do mesmo atributo**.

**Achado da P3-A**: `pim_conflicts.attribute_key` usa o vocabulário interno do extrator (`length`, `connection`), não `attributes.code` (`comprimento`, `conexao`) — confirmado em staging (2 `connection` + 8 `length` abertos que uma comparação ingênua perderia). O gate mapeia explicitamente `comprimento→length`, `conexao→connection` (material/volume são idênticos nos dois vocabulários). Nenhuma associação persistida havia colidido com isso (verificado em staging), mas o gate agora está correto por construção.

Conflito de **outro** atributo do mesmo produto nunca bloqueia — confirmado com dado real (SKU 003359: conflito aberto em `bitola` não bloqueia `comprimento`).

## Publication service (`lib/pim/publication-service.ts`)

`preparePublication(members)` — dry-run read-only, sem lock, sem escrita.

`publishBatch({batchId?, kind, members, baselineReference?, reason?}, actorReference)` — transação única sob `pg_advisory_xact_lock(hashtextextended('pim_publication_batch', 0))` (lock único do subsistema; na escala desta fundação, simples e correto — a PK de `pim_attribute_publications` já impede duplicata por identidade, o lock garante que o **lote inteiro** seja tudo-ou-nada). Reavalia elegibilidade **dentro** da transação (fecha a janela de drift entre prepare/publish). `batchId` é gerado em `crypto.randomUUID()` no lado da aplicação (documentado conforme pedido — permite ao chamador reter o id mesmo antes do INSERT retornar, essencial para o replay idempotente). Reenvio do mesmo `batchId` com o mesmo `member_fingerprint` → replay idempotente (nenhuma escrita nova); mesmo `batchId` com membership diferente → `PimPublicationBatchIdentityConflictError`.

`unpublishBatch(batchId, actorReference, reason?)` — mesma transação/lock; `UPDATE ... WHERE batch_id=X AND state='published'` (nunca `DELETE`); nunca toca `product_attribute_values`/`attribute_values`; idempotente sobre um batch já `rolled_back` (0 linhas afetadas, sem erro).

## Published read model (`lib/pim/publication-read-model.ts`)

`getPublishedProductAttributes(productId)` exige simultaneamente: linha `published` em `pim_attribute_publications` **E** a mesma identidade ainda presente em `product_attribute_values` **E** o `attribute_value` ainda resolver — nunca confia isoladamente no estado de publicação, nem usa `attributes.status` como autoridade.

`getActiveCanaryMembership(productId)` — membership explícita de lote `kind='canary' AND status='active'`, nunca heurística/percentual/"primeiros N".

## Feature modes (`lib/pim/publication-flags.ts`)

`PIM_PUBLICATION_MODE=off|shadow|canary`, deliberadamente **separado** de `lib/catalog/flags.ts` (`CatalogDataSource`/`canaryPercent`, que decide WooCommerce-vs-Postgres para o produto inteiro via cohort bucket). Um produto pode estar no cohort Postgres do catálogo geral com zero atributos PIM publicados, ou permanecer no cohort WooCommerce enquanto participa de um canário de atributos PIM — misturar os dois eixos tornaria qualquer um deles impossível de raciocinar isoladamente. Nenhum destes modos está conectado a rota alguma nesta fase.

## Merge policy (storefront, design apenas — não implementado)

Woo continua fonte principal do produto (preço, estoque, título, descrição, mídia, frete, checkout, pedido — nunca substituídos). Regras propostas para quando `canary` estiver ativo para um produto:
- atributo presente no Woo **e** publicado no PIM → PIM prevalece no campo de atributos (fonte mais estruturada), Woo nunca duplicado visualmente;
- atributo somente no PIM (publicado) → exibido, rotulado como PIM;
- atributo no Woo mas não publicado no PIM → mantém o comportamento atual (Woo), PIM nunca vaza como rascunho;
- `NEEDS_REVIEW` → nunca exibido a partir do PIM em nenhum modo.

## Cache/revalidação (design apenas)

Hoje: `services/woocommerce/products.ts` usa `revalidate` do fetch cache do Next para dados Woo; nada está acoplado ao PIM Postgres porque ele não alimenta a resposta real. No dia em que `canary` passar a alimentar de fato: `publishBatch` → `revalidatePath`/`revalidateTag` do(s) produto(s) do lote; `unpublishBatch` → a mesma invalidação para os mesmos produtos. Nunca limpar cache global por uma publicação de escopo pequeno.

## RLS / segurança

Testado no harness disposable (`scripts/database/pim-publication-foundation-disposable.mjs`): `anon` não lê nem insere em nenhuma das duas tabelas; `authenticated` não insere. Apenas a conexão server-side (equivalente a `service_role` em produção) executa o fluxo — nenhuma rota pública ou Client Component deve importar `lib/pim/publication-service.ts` diretamente.

## Rollout futuro (fora do escopo desta fase)

1. Qualificar um lote real de canário em staging (P3-B) usando os 8 candidatos de fixture da P2-X como referência de forma, revalidando elegibilidade a fresco contra o estado real.
2. Autorização explícita do usuário para `publishBatch` real em staging (nunca produção nesta série).
3. Conectar `getActiveCanaryMembership`/`getPublishedProductAttributes` a `services/catalog/postgres.ts` ou a um novo adapter, respeitando a merge policy acima — mudança de storefront, não de fundação.
4. Wiring de cache/revalidação real.

## Hardening da A3.5E-P3-B

A qualificação contra o schema/dados reais de staging encontrou e corrigiu localmente 3 lacunas antes de qualquer aplicação em staging:

1. **NEEDS_REVIEW não era fail-closed.** PA013710/comprimento e NMEM16/comprimento não tinham nenhuma linha estrutural em `pim_conflicts`/`pim_attribute_reviews` — dependiam de um chamador lembrar de excluí-los manualmente. Corrigido em duas camadas: (a) `lib/pim/publication-needs-review-registry.ts`, um registro explícito e versionado, consultado incondicionalmente por `evaluatePublicationEligibility` (identidade resolvida via SKU→product_id por join ao vivo, nunca autoridade relacional do chamador); (b) estrutural — qualquer linha futura em `pim_attribute_reviews` com `status='needs_review'` agora também bloqueia, sem exigir mudança de código. Replay completo sobre as 1855 associações reais de staging confirmou exatamente `ELIGIBLE=1853, NEEDS_REVIEW=2`, todos os demais motivos em zero.
2. **Ausência de autoridade de baseline.** `publishBatch`/`preparePublication` agora exigem `baselineReference === CURRENT_PIM_BASELINE_SHA256` (`lib/pim/publication-baseline.ts`, o hash canônico do baseline PIM v1 da P2-X) — qualquer valor ausente/errado é rejeitado antes de qualquer eligibility check ou escrita.
3. **Reuso de batch revertido tratado incorretamente como idempotente.** Um `batchId` com `status='rolled_back'` é agora terminal: reenviá-lo (mesmo com membership idêntica) lança `PimPublicationBatchAlreadyRolledBackError` em vez de ser silenciosamente lido como "ainda publicado". Republicar os mesmos membros exige um novo `batchId`.

Também confirmado (sem mudança de código, apenas medição): `pim_conflicts.attribute_key='length'/'connection'` (achado da P3-A) tem 8+2 ocorrências reais abertas em staging, **zero** colidindo com qualquer associação persistida; o controle positivo SKU 003359 (conflito `bitola` não bloqueia `comprimento`) foi revalidado com dado real.

## Riscos residuais

- O mapeamento `attribute_key` do eligibility gate cobre apenas os 4 atributos canônicos desta fase; um 5º atributo canônico futuro exigiria estender `DB_CODE_TO_CONFLICT_ATTRIBUTE_KEY` explicitamente (falha segura: `ATTRIBUTE_NOT_SUPPORTED` bloqueia por padrão, nunca assume elegibilidade).
- `NEEDS_REVIEW` documental (PA013710/comprimento, NMEM16/comprimento) não tem coluna própria no banco; o bloqueio hoje depende do registro estático `lib/pim/publication-needs-review-registry.ts` (ver Hardening P3-B acima), não de uma coluna dedicada. Uma futura linha estrutural em `pim_attribute_reviews` para esses dois casos tornaria o registro redundante, mas não há urgência em migrá-los enquanto o registro cobrir os casos conhecidos.
- Lock único global serializa todas as publicações do projeto inteiro; aceitável na escala de canário desta fase, deveria ser revisto (locks por batch ou por produto) se o volume crescer.

## Hardening da A3.5E-P3-F

A auditoria de propriedade/rebind entre batches (mandato da própria tarefa P3-F) encontrou uma lacuna real de integridade em `publishBatch`, corrigida localmente antes de qualquer replay em staging:

1. **Rebind silencioso de `batch_id` entre batches distintos.** O `INSERT ... ON CONFLICT (product_id, attribute_id, attribute_value_id) DO UPDATE SET batch_id=excluded.batch_id, ...` por membro não verificava o estado anterior da linha: um batch novo contendo uma identidade já `published` por OUTRO batch simplesmente reatribuía a propriedade, sem nenhum rastro de auditoria que mencionasse o dono anterior. Corrigido adicionando, antes do upsert de cada membro, um `SELECT state, batch_id ... FOR UPDATE` que trava a linha e lança `PimPublicationOwnedByAnotherBatchError` sempre que `state='published'` — abortando a transação inteira (all-or-nothing; nenhum rebind parcial). Uma linha ausente ou `state='unpublished'` continua podendo ser (re)publicada por um novo batch — transição permitida e intencional.
2. **Consequência esperada em teste de concorrência pré-existente.** O teste de 2 publicações concorrentes na mesma identidade (batches diferentes) antes assumia "ambas cumprem" (last-write-wins silencioso); após a correção, exatamente uma cumpre e a outra é rejeitada deterministicamente com `OWNED_BY_ANOTHER_BATCH` — documentado no próprio teste como o novo comportamento correto, não uma regressão.

Confirmado via `scripts/database/pim-publication-foundation-disposable.mjs` (Docker descartável, 2 execuções independentes) e via qualificação read-only contra o staging real: o único batch real existente (`63a1969c-8e1f-498f-9eda-1ba7db15e7c1`, 8 membros) não tem nenhuma sobreposição de identidade com nenhum outro batch (não há outro batch em staging), portanto a correção não altera nenhum dado já publicado — apenas fecha a lacuna para qualquer publicação futura.
