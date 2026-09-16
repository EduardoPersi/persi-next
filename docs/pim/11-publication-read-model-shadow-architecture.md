# PIM Publication Read Model & Shadow Architecture (A3.6-A)

Esta rodada NÃO conecta o PIM ao storefront. PIM continua NÃO sendo fonte oficial de catálogo. Todo o código aqui descrito permanece desconectado de `app/`, `components/` e de qualquer route handler público — provado por teste (ver Seção 6).

## 1. Caminho oficial atual do catálogo

Mapeado por auditoria de código real (não de docs antigos):

- **Roteamento**: `app/[...segments]/page.tsx` resolve, em ordem, institucional → categoria (`getAllProductCategories`/`findCategoryByPath`) → produto (`getProductBySlug`) → post. Busca é servida por `app/busca/page.tsx` → `app/_storefront/search-page.tsx`.
- **Fonte oficial**: `services/woocommerce/*` (via Store API, `services/woocommerce/client.ts`) é a única fonte que efetivamente responde ao cliente. `services/catalog/woocommerce.ts::mapWooProductToCatalog` converte para o tipo genérico `CatalogProduct` (`lib/catalog/domain.ts`) apenas para permitir a comparação de sombra abaixo — não para servir resposta.
- **`decideCatalogSource`/`catalogBucket`** (`lib/catalog/routerCore.ts`, `lib/catalog/flags.ts`) existem e estão implementados, mas são código morto em produção: nenhuma rota os importa, nenhum cookie de cohort é setado.
- **Shadow read existente**: `officialReadWithShadow` (`lib/catalog/shadowCore.ts`) sempre retorna o resultado oficial (Woo) incondicionalmente; o lado Postgres alimenta apenas `compareInBackground` → `compareCatalogProducts` (`lib/catalog/comparison.ts`) → log, nunca a resposta HTTP. Ligado apenas na PDP via `scheduleProductShadow` (`services/catalog/productShadow.ts`), chamado de `services/woocommerce/products.ts::getProductBySlug`.
- **`services/catalog/postgres.ts`**: usado somente pelo shadow read acima (nunca pela resposta oficial). Uma mudança não commitada adiciona `and a.status='active'` ao subquery de atributos (gate `A3.5E-P2-J`, storefront-only).
- **Tipo de atributo real**: `ProductAttribute { id, name, taxonomy, hasVariations, terms: [{id,name,slug}], options: [...] }` (`types/product.ts`). Multi-valor via `terms[]`. Sem campo de ordem explícito (ordem = ordem do array). Valores compostos (`25mm x 1/2"`) são strings opacas, nunca decompostas.
- **Cache**: `fetch` com `next.revalidate` por chamada (120s produto, 30s variações, 86400s bulk); zero uso de `revalidateTag`/`unstable_cache` no caminho de catálogo.
- **Route handlers públicos**: `app/api/catalog/{products/[slug],category-products,brand-products}/route.ts` — todos wrappers finos sobre `services/woocommerce/*`, nenhum toca PIM.

## 2. Read model de publicação nativo (`lib/pim/publication-read-model.ts`)

Estendido (não substituído) nesta rodada. Preserva as duas funções da A3.5 (`getPublishedProductAttributes`, `getActiveCanaryMembership`) e adiciona:

- `getPublishedAttributesForProducts(productIds: string[])`: uma única query para N produtos (sem N+1), retorna `Map<productId, PublishedAttributeRecord[]>` com uma entrada garantida para todo id pedido (mesmo vazia).
- `getPublishedAttributesForProduct(productId)`: wrapper de conveniência para PDP (chama a versão em lote com 1 id).
- `explainNonExposableAttributesForProduct(productId)`: diagnóstico interno (nunca para storefront) que devolve os `blockReasons` de cada linha.

Toda linha crua passa por **uma única função autoritativa** antes de virar resultado.

## 3. Semântica de exposição (`lib/pim/publication-exposability.ts`)

`isPublicationExposable(input): { exposable, blockReasons[] }` é o único lugar do repositório que decide se uma linha de publicação é exposable. Bloqueia por: `NOT_PUBLISHED`, `BATCH_NOT_ACTIVE` (inclui batch órfão — `LEFT JOIN`, nunca `INNER JOIN`, para que a ausência do batch chegue como `null` e seja tratada como não-ativa, nunca descartada silenciosamente antes de classificar), `MISSING_SOURCE_ASSOCIATION`, `IDENTITY_MISMATCH` (PAV mudou de valor depois da publicação), `MISSING_ATTRIBUTE`, `MISSING_ATTRIBUTE_VALUE`. Testado exaustivamente offline (`tests/pimA36AExposabilityAndReadModel.test.mjs`) e contra Postgres real descartável (`scripts/database/pim-publication-read-model-disposable.mjs`).

## 4. Candidate model (`lib/pim/publication-candidate.ts`)

`PimCatalogCandidate { productId, source: "pim-candidate", attributes: CatalogTerm[] }` — reaproveita o tipo `CatalogTerm{code,name,value}` já usado pelo comparador de sombra existente (`lib/catalog/comparison.ts`), evitando uma camada de tradução. Contém **somente** atributos que já passaram por `isPublicationExposable`. `buildPimCatalogCandidate` é pura: não faz I/O, não muta o array de entrada, não muta nenhum objeto oficial.

## 5. Modelo de comparação (`lib/pim/publication-shadow-comparison.ts`)

Deliberadamente **separado** de `lib/catalog/comparison.ts` (que compara o catálogo inteiro Woo-vs-Postgres em um bucket único `"attributes"`). Este novo comparador é granular por atributo (`code`), determinístico, sem IA:

`MATCH | PIM_ONLY | OFFICIAL_ONLY | VALUE_DIFFERENCE | MULTI_VALUE_DIFFERENCE | ORDER_ONLY_DIFFERENCE | UNRESOLVABLE | BLOCKED`

`BLOCKED` é emitido sempre que o código do atributo corresponde a uma entrada do `KNOWN_NEEDS_REVIEW_REGISTRY` para o SKU oficial daquele produto — checado sincronamente via `official.sku`, sem join a banco.

`safeForFutureCanary` é uma regra determinística e documentada (não um score): verdadeiro somente se **todo** código que o candidate efetivamente publica classifica como `MATCH`. Códigos que o candidate não toca (`OFFICIAL_ONLY`) não contam contra essa flag — eles simplesmente não fazem parte do que esse candidate poderia canarizar hoje. `safeForFutureCanary=true` **não** significa "seguro publicar" — só significa que a comparação não achou motivo, hoje, para bloquear uma decisão humana futura de canarizar os atributos já publicados.

Matriz de 15 casos determinísticos testada em `tests/pimA36AShadowComparison.test.mjs`, incluindo o caso de regressão explícito: os 8 membros do canário real da A3.5, agora `rolled_back`, produzem candidate vazio (`OFFICIAL_ONLY` para tudo), nunca `MATCH` fabricado.

## 6. Garantia de zero vazamento público

- Teste `git grep -l "lib/pim/publication-" -- app components` → vazio (nenhum arquivo).
- Teste estático: `services/catalog/postgres.ts` não referencia nenhuma tabela/módulo de publicação.
- Nenhuma flag pública foi ligada nesta rodada (ver Seção 7).

## 7. Modelo de feature flags

Auditado antes de criar qualquer flag nova: `lib/pim/publication-flags.ts` já define `PimPublicationMode = "off" | "shadow" | "canary"` (`getPimPublicationFlags` lê `PIM_PUBLICATION_MODE`, default `"off"`). Isso já cobre exatamente a separação pedida pela tarefa (`PIM_SHADOW_ENABLED`/`PIM_STOREFRONT_CANARY_ENABLED`/`PIM_STOREFRONT_OFFICIAL_ENABLED`) sem permitir combinações contraditórias (um enum de 3 estados mutuamente exclusivos é estritamente mais seguro que 3 booleanos independentes). **Nenhuma flag nova foi criada nesta rodada** — seria duplicação. Nenhuma variável de ambiente foi alterada em staging/Hostinger; `PIM_PUBLICATION_MODE` continua não-setada (`"off"` implícito) em todos os ambientes.

## 8. Query batching / performance

`getPublishedAttributesForProducts` faz exatamente 1 SELECT para N produtos (`where pap.product_id in (...)`, lista parametrizada), com `LEFT JOIN`s em `pim_publication_batches`, `attributes`, `attribute_values`, `product_attribute_values` — todos por chave primária/índice existente (nenhum novo índice necessário nesta rodada). Validado com 1 produto (PDP) e 5 produtos simultâneos (Docker descartável) sem N+1 — provado estaticamente por teste (`sqlCallCount === 1`) e por execução real. Nenhuma carga destrutiva ou benchmark de produção foi executada; nenhuma metodologia de p50/p95 foi aplicada nesta rodada por não haver ambiente válido para medir sem afetar staging real.

## 9. Cache (observação, não implementação)

O read model nativo não define cache próprio ainda — é chamado direto ao banco. Observações para uma futura A3.6-B:

- **Chave de cache natural**: por `productId` (ou lote de `productId`s), já que a query é assim particionada.
- **Invalidação obrigatória**: qualquer `publishBatch`/`unpublishBatch` futuro precisa invalidar o cache de candidate/shadow para os `productId`s do batch afetado — hoje não existe esse hook porque nada usa cache ainda. Um `revalidateTag` por produto (`pim-candidate:${productId}`) é a estratégia mais natural quando isso for implementado.
- **Risco de staleness**: como publication rows podem ser revertidas (rollback), um cache de candidate sem invalidação correta poderia continuar expondo (em modo shadow/log, nunca em resposta pública nesta fase) um atributo já revertido — por isso a invalidação deve ser tratada como requisito, não otimização, quando shadow runtime for de fato ligado.

## 10. Fronteira de segurança

- Todo o novo código é `import "server-only"` (herdado do padrão já usado em `publication-service.ts`/`publication-read-model.ts`).
- Nenhuma credencial Supabase/Postgres é usada fora de `lib/db`/scripts server-only.
- Nenhuma tabela de publicação é exposta como API pública genérica; os únicos consumidores são testes e scripts descartáveis.
- Tipos de domínio (`PublishedAttributeRecord`, `PimCatalogCandidate`, `CatalogShadowComparison`) não vazam nenhum campo de banco além do estritamente necessário (sem `id` interno de linha, sem colunas de auditoria).

## 11. Backlog estrutural — NEEDS_REVIEW

A P3-H provou que `pim_attribute_reviews.status='needs_review'` é suportado estruturalmente (valor default da coluna, check constraint permite ausência de `reviewed_by`/`reviewed_at` nesse status, unique constraint por identidade). A lacuna é puramente de dado: as 2 linhas reais (`PA013710/comprimento`, `NMEM16/comprimento`) nunca foram inseridas. `lib/pim/publication-needs-review-registry.ts` continua sendo o único mecanismo funcional, consultado por **dois** consumidores nesta rodada — `lib/pim/publication-eligibility.ts` (gate de elegibilidade, A3.5) e `lib/pim/publication-shadow-comparison.ts` (classificação `BLOCKED`, A3.6-A, defesa em profundidade). **Nenhum INSERT, migration ou alteração do registry foi feito nesta rodada.** Backlog obrigatório antes de expandir a publication layer além do canário: inserir as 2 linhas estruturais reais em uma rodada de escrita futura autorizada e então avaliar se o registry pode ser reduzido/removido.

## 12. Observação sobre o advisory lock

`withPublicationLock` (`lib/pim/publication-service.ts`) usa `pg_advisory_xact_lock(hashtextextended('pim_publication_batch', 0))` — uma chave **constante**, ignorando `batchId`/`productId`/`attributeId`. Escopo: **global**, serializa TODAS as chamadas de `publishBatch` e `unpublishBatch` do projeto inteiro, uma de cada vez. Na escala atual (1 batch histórico, operações pontuais e raras) isso não é um problema real — não há evidência de contenção. Estratégias futuras, caso o volume cresça: lock por batch (`hashtextextended(batchId, 0)`), por produto, por atributo, ou locking determinístico multi-chave (adquirir N locks em ordem canônica ordenada por identidade, permitindo paralelismo real entre batches que não compartilham nenhuma identidade). **Nenhuma mudança de locking foi feita nesta rodada** — não havia bug local crítico que impedisse a própria A3.6-A.

## 13. Pré-requisitos para A3.6-B

Antes de qualquer wiring real (mesmo que só shadow/log, nunca resposta pública):

1. Definir e implementar a estratégia de invalidação de cache (Seção 9) antes de cachear qualquer candidate.
2. Resolver o backlog de NEEDS_REVIEW estrutural (Seção 11) ou aceitar explicitamente que o registry estático continua sendo a autoridade por mais uma fase.
3. Decidir, com autorização explícita e separada, se/quando `PIM_PUBLICATION_MODE=shadow` será de fato ligado em algum ambiente (nunca nesta rodada).
4. Definir onde `officialReadWithShadow`/`scheduleProductShadow` (padrão já existente) se encaixaria para também comparar o candidate PIM, ou se a A3.6-B usará um mecanismo de log separado.

PIM continua não sendo fonte oficial de catálogo. Nenhuma dessas pré-condições autoriza publicação, storefront wiring ou produção.
