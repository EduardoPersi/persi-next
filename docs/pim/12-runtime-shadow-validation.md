# PIM Runtime Shadow Integration & Validation (A3.6-B)

**PIM continua NÃO sendo fonte oficial.** Esta rodada conecta observação shadow a UM caminho real (PDP), com `PIM_PUBLICATION_MODE` default `"off"` em todo ambiente — na prática, hoje, isso é um no-op em produção.

## 1. Topologia runtime

```
getProductBySlug()  (services/woocommerce/products.ts)
  └─ scheduleProductShadow(product)  (services/catalog/productShadow.ts)
        ├─ officialReadWithShadow(...)   -- shadow Woo-vs-Postgres PRÉ-EXISTENTE (inalterado)
        └─ runPimCatalogShadow(official, "product")   -- NOVO, A3.6-B
```

`official` (o `CatalogProduct` já mapeado de Woo) é computado **uma única vez**, de forma preguiçosa/memoizada, e compartilhado pelos dois shadows — nunca recomputado, nunca uma segunda fonte de verdade.

**Retorno de `getProductBySlug` é byte-a-byte o mesmo objeto que seria retornado sem nenhum dos dois shadows.** Nenhuma função neste caminho combina/decide entre official e PIM.

## 2. Invariância da resposta oficial

- `scheduleProductShadow`: assinatura `(product: Product): void`. Chamada sem `await` em `getProductBySlug` (`if (product) scheduleProductShadow(product);`).
- `runPimCatalogShadow`/`runPimCatalogShadowForList`: sempre `void`, nunca retornam candidate/comparação para o chamador — impossível compor no output por construção (testado).
- **Achado real corrigido nesta rodada**: a primeira versão computava `mapWooProductToCatalog(product)` de forma síncrona/eager no topo de `scheduleProductShadow`. Um produto malformado faria essa chamada lançar **sincronamente**, escapando de `scheduleProductShadow` (que é chamado sem guarda em `getProductBySlug`) e potencialmente quebrando a página real. Corrigido: o mapeamento agora é sempre preguiçoso (getter memoizado) e a chamada do shadow PIM está dentro de um `try/catch` que nunca deixa uma exceção escapar. Regressão coberta por teste (`tests/pimA36BOfficialResponseInvariance.test.mjs`).
- Escopo declarado: **somente PDP** está conectada nesta rodada. `runPimCatalogShadowForList` (para category/listing/search) existe e está testada isoladamente, mas **nenhuma rota a chama ainda** — provado por `git grep` em testes dedicados.

## 3. Reauditoria do request path

Reconfirmado nesta rodada (auditoria de código, não assumido de rodadas anteriores): `services/woocommerce/*` continua a única fonte que chega à resposta HTTP; `decideCatalogSource`/`catalogBucket` (`lib/catalog/routerCore.ts`) permanecem código morto, não reativados nesta rodada (nenhuma justificativa arquitetural surgiu para religá-los, e fazê-lo estaria fora do escopo de "não reviver dead code sem justificativa").

## 4. Fail-open (official) vs fail-closed (PIM)

Duas semânticas comprovadas por 15+ testes de matriz de falha (`tests/pimA36BShadowRuntime.test.mjs`):

- **Official**: qualquer falha do shadow (timeout, erro de conexão, comparador lançando exceção, telemetria lançando exceção, linha malformada) nunca impede/altera a resposta oficial — `scheduleProductShadow` sempre retorna `undefined`, nunca propaga.
- **PIM exposability**: qualquer inconsistência (`rolled_back`, `unpublished`, source ausente, identidade errada) já é filtrada estruturalmente pelo read model (A3.6-A) antes mesmo de chegar aqui — o orchestrator nunca "corrige" isso, apenas recebe um resultado vazio.

## 5. Timeout / budget

`DEFAULT_TIMEOUT_MS = 500` (conservador; sem alterar environment). `withTimeout` corre a promise real contra um timer; se o timer vence, emite telemetria `shadowStatus:"timeout"` e abandona a promise original (Promises não são canceláveis em JS). **Achado real corrigido**: a promise abandonada podia terminar depois e emitir uma SEGUNDA telemetria para a mesma observação — provado ao validar contra staging real (uma conexão fria excedeu 500ms, e a resolução tardia gerou um evento duplicado `completed` após o `timeout`). Corrigido com uma guarda `emitted` de disparo único por observação. Regressão coberta por teste dedicado.

## 6. Telemetria

Evento `PimCatalogShadowTelemetryEvent { productId, routeKind, classification, differenceCount, publishedAttributeCount, durationMs, shadowStatus, errorClass }`. **Nunca** inclui PII, endereço, e-mail, telefone, cookies, tokens, `DATABASE_URL`, descrição completa do produto. `productId` é o id interno PIM (uuid), não um identificador de cliente.

## 7. Sampling / cardinalidade

`isSampled(key, percent)` usa FNV-1a determinístico (`stableHash`) sobre o `slug` do produto — o mesmo produto sempre cai na mesma amostra entre requisições/instâncias, ao contrário de `Math.random()`. Taxa lida de `PIM_SHADOW_SAMPLE_RATE` (0-100, default **0**) via extensão de `lib/pim/publication-flags.ts` — nova, não duplica `CATALOG_SHADOW_SAMPLE_RATE` (mesma razão arquitetural já documentada para `PimPublicationMode` vs `CatalogDataSource`). `mode=shadow` sozinho **não** liga amostragem — os dois knobs precisam ser ligados deliberadamente. **Nenhuma variável de ambiente foi alterada**; sample rate efetivo hoje é 0 em todo ambiente.

## 8. Batching

`runPimCatalogShadowForList` resolve N produtos e busca atributos publicados em **uma única chamada em lote** (reaproveitando `getPublishedAttributesForProducts` da A3.6-A), nunca N+1 — provado por teste (`fetchCallCount===1` para múltiplos produtos) e por execução real (Docker descartável).

## 9. Comparação shadow

Reaproveita integralmente `lib/pim/publication-shadow-comparison.ts` (A3.6-A) — nenhuma lógica duplicada. `summarizeClassification` apenas resume o pior caso entre as diferenças para telemetria agregável (`BLOCKED > UNRESOLVABLE > VALUE_DIFFERENCE > MULTI_VALUE_DIFFERENCE > ORDER_ONLY_DIFFERENCE > PIM_ONLY > OFFICIAL_ONLY > MATCH`).

## 10. Validação real em staging (read-only)

Staging permanece `rolled_back` (`published=0`, `unpublished=8`). Rodando o orchestrator real (com resolução real de `productId` via os 8 identities congeladas) contra staging: todos os 8 retornaram `publishedAttributeCount=0`, `classification=OFFICIAL_ONLY`, exatamente 1 evento cada (sem duplicação, já com a correção do item 5). BEFORE/AFTER de `pim_publication_batches`, `pim_attribute_publications`, `product_attribute_values`, `attribute_values`, `pim_audit_log`, `pim_attribute_reviews`, `pim_attribute_decisions`, `pim_conflicts` — todos idênticos. **Zero escritas.**

## 11. Validação positiva (descartável)

Como staging tem zero linhas published (corretamente, pós-rollback), o caso positivo foi provado exclusivamente em Postgres descartável (`scripts/database/pim-shadow-runtime-disposable.mjs`): produto com PIM publicado igual ao oficial → `MATCH`; produto com PIM divergente do oficial → `VALUE_DIFFERENCE`, com o objeto oficial permanecendo inalterado em ambos os casos; `mode=off` não agenda nada mesmo com produto real resolvível; zero escritas do próprio shadow observado por contagem antes/depois.

## 12. NEEDS_REVIEW

`BLOCKED` (via `lib/pim/publication-shadow-comparison.ts`, reaproveitado sem duplicação) continua sendo emitido para os 2 casos do registry estático, testado explicitamente no runtime (`tests/pimA36BShadowRuntime.test.mjs`, caso 13). Nenhuma escrita de review estrutural feita nesta rodada — backlog inalterado (ver `docs/pim/11-publication-read-model-shadow-architecture.md` Seção 11).

## 13. Fronteira de cache

Nenhuma cache key, TTL ou estratégia de revalidação oficial foi alterada. O shadow roda **depois** que `official` já foi computado e é totalmente independente do cache de `fetch()` do Woo. Invalidação de um futuro cache de candidate/comparação continua apenas documentada (não implementada) — ver Seção 9 do documento 11.

## 14. Não-bloqueio / latência

`scheduleWithAfter` prefere `next/server`'s `after()` (primitivo oficial do Next para "trabalho pós-resposta", correto tanto em hospedagem persistente quanto serverless/edge) com fallback seguro (`try/catch` → fire-and-forget puro, o mesmo padrão já usado pelo shadow Woo-vs-Postgres pré-existente) para qualquer contexto onde `after()` não seja chamável (ex.: scripts, testes). Prova arquitetural: `runPimCatalogShadow` nunca é `await`ado por `scheduleProductShadow`; prova por teste: a função retorna `undefined` imediatamente, e o trabalho real roda dentro do `schedule(...)` callback, nunca no caminho síncrono de retorno.

## 15. Segurança

- Todo o novo código é `server-only`.
- Nenhum import server-only chega a `app/`/`components/` (testado via `git grep`).
- Nenhuma linha de publicação interna é serializada para o cliente — telemetria e comparação ficam inteiramente no servidor.
- Nenhum erro interno do PIM aparece na resposta HTTP (garantido pelos testes de fail-open).
- Nenhuma credencial é usada fora de `lib/db`.
- Nenhuma API de mutação foi criada.

## 16. Pré-requisitos para A3.6-C

1. Decisão explícita e separada sobre se/quando `PIM_PUBLICATION_MODE=shadow` e `PIM_SHADOW_SAMPLE_RATE>0` serão de fato ligados em QUALQUER ambiente (nunca nesta rodada).
2. Escolher e implementar um sink de telemetria real (hoje é só a interface `ShadowTelemetrySink`, sem destino configurado).
3. Resolver o backlog estrutural de NEEDS_REVIEW (documento 11, Seção 11) antes de qualquer expansão de escopo de comparação.
4. Decidir explicitamente se/quando conectar `runPimCatalogShadowForList` a category/listing/search.

PIM continua não sendo fonte oficial de catálogo. Nenhuma dessas condições autoriza publicação, ativação pública de shadow, ou produção.
