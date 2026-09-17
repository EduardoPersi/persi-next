# Controlled Shadow Activation Plan (A3.6-D2, proposta — NENHUMA execução)

**Este documento é um plano. Nenhuma variável de ambiente foi alterada, nenhum shadow foi ativado, nenhum deploy foi feito por causa deste documento.** A execução real exigirá uma rodada A3.6-D2 separada, com autorização explícita do operador.

## Pré-condição

Este plano só é válido porque `A3.6-D1.8` foi fechado com sucesso (ver `docs/pim/18-existing-staging-safety-deployment.md`, seção R6):

```
STAGING_DATABASE_BINDING=MATCH
DATABASE_BINDING_LIVE_PROVEN=YES
A3_6D18_PASS=YES
SAFE_TO_REQUEST_A3_6_D2_CONTROLLED_SHADOW_ACTIVATION=YES
```

## Escopo

Ativar o shadow do PIM **somente** em `staging.persimateriais.com.br`. Produção nunca é tocada por este plano.

## Configuração futura pretendida (env, somente em staging)

```
PERSI_RUNTIME_ENV=staging
PIM_PUBLICATION_MODE=shadow
PIM_SHADOW_SAMPLE_RATE=1
PIM_SHADOW_TELEMETRY_SINK=console
```

**Interpretação obrigatória**: `PIM_SHADOW_SAMPLE_RATE=1` significa **1%**, nunca 100% — a escala é 0–100 (ver `lib/pim/publication-flags.ts`), deliberadamente diferente da escala 0–1 usada pelo mecanismo pré-existente e não relacionado `CATALOG_SHADOW_SAMPLE_RATE`.

## O que D2 NÃO deve fazer

- Alterar a resposta oficial ao cliente (a fonte oficial continua o WooCommerce, sempre).
- Publicar nenhum atributo PIM.
- Mudar a fonte de dados do storefront.
- Escrever no banco (o shadow é somente leitura + comparação).
- Chamar qualquer provider externo (pagamento, ERP, frete, mensageria).
- Afetar produção de nenhuma forma, direta ou indireta.

O PIM atua exclusivamente como uma comparação em segundo plano (`shadow`) contra a resposta oficial já servida pelo Woo — nunca como substituto dela.

## Requisitos de observabilidade antes de executar D2 (Seção 13)

Antes de qualquer ativação real, a rodada D2 deve confirmar/possuir:

1. Logs de staging isolados de produção (já garantido pela separação de processo Passenger, qualificada em D1.7).
2. `PIM_SHADOW_TELEMETRY_SINK=console` disponível e funcional (`consolePimShadowTelemetrySink`, já implementado e testado em A3.6-C — adapta a convenção pré-existente `console.info("[tag]", ...)`).
3. Evento estruturado por observação, sem PII e sem nenhum segredo (`PimCatalogShadowTelemetryEvent`, já tipado e testado).
4. **Uma única emissão por request amostrado** — já garantido pelo guard `emitted` de fire-único em `observeOnce` (`lib/pim/publication-shadow-runtime.ts`), que corrigiu exatamente esse bug (telemetria duplicada por timeout) durante a validação ao vivo de A3.6-B.
5. Timeout de 500ms preservado (já implementado, já testado).
6. Erro do lado PIM nunca afeta a resposta oficial — fail-open para o official, fail-closed para o PIM (já implementado e testado em A3.6-B, `runPimCatalogShadow`/`runPimCatalogShadowForList`, sempre `void`, nunca lança para o chamador).
7. Classificação `OFFICIAL_ONLY` esperada como resultado predominante enquanto não houver nenhuma publicação real (`published=0`, confirmado em D1.8) — qualquer resultado diferente de `OFFICIAL_ONLY`/erro seria inesperado e deve ser investigado antes de prosseguir.
8. Capacidade comprovada de reverter imediatamente para `off`/`0`/`noop` só com env (ver contrato de rollback abaixo) — sem depender de um novo deploy de código.

## Contrato de rollback (Seção 14)

Reversão de D2 é **somente env**, em staging:

```
PIM_PUBLICATION_MODE=off
PIM_SHADOW_SAMPLE_RATE=0
PIM_SHADOW_TELEMETRY_SINK=noop
```

Explicitamente **sem**:
- rollback de banco;
- publicação ou despublicação de qualquer atributo;
- qualquer ação em produção.

## Próximo passo

Aguardar uma rodada `A3.6-D2` separada, formalmente autorizada pelo operador, para executar (não apenas planejar) a ativação controlada do shadow em staging.

---

## A3.6-D2-A — Resultado do preflight (qualificação local, nenhuma ativação)

**Todas as verificações abaixo foram feitas por código/teste local, sem alterar env, sem deploy, sem acessar Hostinger, sem escrever no banco.**

### Semântica das envs (Seção 3, provado por código)
`getPimPublicationFlags()` (`lib/pim/publication-flags.ts`): `PIM_SHADOW_SAMPLE_RATE` é lido via `Number(...)`, sujeito a `Math.min(100, Math.max(0, rawRate))`, e cai para `0` se não for finito — nunca vira uma fração 0–1 nem um booleano. `isSampled(key, percent)` (`lib/pim/publication-shadow-runtime.ts`): `percent<=0` → `false`; `percent>=100` → `true`; caso contrário `stableHash(key) % 100 < percent`. Com `percent=1`, isso é verdadeiro para exatamente 1 em cada 100 valores de hash possíveis — **1%, comprovado por execução real local**: 500 rótulos de exemplo determinísticos (`produto-exemplo-0001`...`0500`, ilustrativos, não uma alegação de produtos reais) produziram exatamente 5 elegíveis (1%).

### Isolamento da resposta oficial (Seção 4, provado por código + 126 testes locais)
`getProductBySlug` (`services/woocommerce/products.ts`) obtém o produto oficial do Woo, dispara `scheduleProductShadow(product)` sem `await`, e retorna imediatamente — o retorno de `scheduleProductShadow` é `void`. Três camadas independentes de contenção de erro: (1) `scheduleProductShadow` envolve a chamada a `runPimCatalogShadow` em `try/catch`, com mapeamento Woo→catálogo preguiçoso/memoizado (nunca no topo da função, regressão específica já corrigida em A3.6-B); (2) `scheduleWithAfter` envolve `after()` em `try/catch` com fallback fire-and-forget; (3) `observeOnce` envolve todo o trabalho + timeout em `try/catch`, com guarda de emissão única (`emitted`) e `emit()` também blindado contra sink que lança/rejeita. Confirmado por 126/126 testes locais reexecutados nesta rodada, incluindo timeout, erro de DB, comparador que lança, sink que lança, registro malformado — em nenhum caso a resposta oficial é alterada.

### Escopo real (Seção 5, reauditado nesta rodada)
```
SHADOW_RUNTIME_SURFACES=["PDP (product_by_slug, via getProductBySlug -> scheduleProductShadow)"]
```
`runPimCatalogShadowForList` existe e é testado isoladamente, mas nenhuma rota/página/componente a importa (confirmado por `git grep`, reconfirmado pelo teste "scope guard reconfirmed"). Listing/categoria/busca **não estão conectados**.

### Comportamento com zero publicações (Seção 6, provado por código)
`compareOfficialWithPimCandidate` classifica todo código de atributo oficial ausente do candidato como `OFFICIAL_ONLY`. Com `published=0` (candidato sempre vazio), **todas** as diferenças são `OFFICIAL_ONLY`, e `summarizeClassification` (ordem de severidade) produz `OFFICIAL_ONLY` como agregado — nunca `MATCH`, nunca erro. Confirmado também por teste direto (`classification, "OFFICIAL_ONLY"` com `publishedAttributeCount=0`).

### Telemetria (Seção 7)
Campos exatos emitidos (`PimCatalogShadowTelemetryEvent`): `productId` (uuid interno do PIM ou `null`, nunca identificador de cliente), `routeKind`, `classification`, `differenceCount`, `publishedAttributeCount`, `durationMs`, `shadowStatus`, `errorClass` (nome de classe/`"timeout"`/`"unknown"`, nunca stack trace ou connection string). Nenhum campo de PII, nenhum slug/SKU no evento. `getConfiguredTelemetrySink` seleciona `console` apenas com match exato da string `"console"`; qualquer outro valor (incluindo `"CONSOLE"`, vazio, com espaços) cai em `noop`. Confirmado por teste: uma única emissão por observação amostrada, mesmo com timeout tardio; sink que lança/rejeita nunca escapa.

### Observabilidade Hostinger (Seção 8)
```
HOSTINGER_SHADOW_LOG_OBSERVABILITY=PARTIALLY_PROVEN
```
Em D1.7, `hosting_getNode_jsRuntimeLogsV1` foi testado com sucesso contra staging e retornou linhas reais de `console.*` da aplicação (ex.: `"[woocommerce-free-shipping] WORDPRESS_URL não está configurada."`), confirmando que o mecanismo captura `console.info`/`console.error` do processo real, isolado de produção — o mesmo padrão que `consolePimShadowTelemetrySink` usa (`console.info("[pim-catalog-shadow]", event)`). Porém essa ferramenta está com `CONNECT_TIMEOUT` persistente desde então (14+ tentativas across D1.8→R1→R2→R4, nunca mais reconectada) e não foi reverificada nesta rodada (Hostinger não foi acessada, conforme proibido). **Verificação humana mínima exigida antes/depois de uma ativação real**: confirmar que `hosting_getNode_jsRuntimeLogsV1` volta a responder, e idealmente observar uma linha `[pim-catalog-shadow]` real após uma requisição amostrada.

### Plano de requests (Seção 9)
Não foi possível produzir uma lista de slugs REAIS: este repositório não mantém nenhum cache local do catálogo (leitura sempre ao vivo via Woo/Postgres), e nenhuma chamada de rede foi feita nesta rodada (proibida). Nenhum slug foi inventado como se fosse produto real. Em vez disso, o mecanismo de seleção foi demonstrado com rótulos ilustrativos (`produto-exemplo-NNNN`) via a função real `isSampled`. Procedimento para a rodada de execução: aplicar `isSampled(slug, 1)` (mesma função, sem alteração) a uma lista de slugs reais fornecida pelo operador ou obtida por uma leitura read-only já aprovada do catálogo — trivial e imediato uma vez disponível.

### Response invariance gate (Seção 10)
```
RESPONSE_INVARIANCE_GATE_DEFINED=YES
```
Comparar, para o mesmo conjunto pequeno de PDPs, ANTES e DEPOIS da ativação: HTTP status, nome/slug do produto, preço (regular e com desconto Pix), status de estoque, atributos oficiais exibidos, canonical URL, e os campos relevantes do JSON-LD de `Product`/`Offer`. Não comparar o HTML byte-a-byte (conteúdo naturalmente variável: banners, recomendados, timestamps). Qualquer diferença nesses campos é motivo de rollback imediato (Seção 12).

### Performance gate (Seção 11)
`DEFAULT_TIMEOUT_MS=500` confirmado em código, isolado da resposta oficial (shadow roda via `after()`, pós-resposta). Observar na execução futura: taxa de `shadowStatus=timeout`/`error`, ausência de telemetria duplicada por request, e ausência de qualquer regressão de latência da resposta oficial (nenhuma medição de p95 real existe hoje — não inventada).

### Rollback (Seção 12)
Confirmado por código: reverter é só env (`PIM_PUBLICATION_MODE=off`, `PIM_SHADOW_SAMPLE_RATE=0`, `PIM_SHADOW_TELEMETRY_SINK=noop`, mantendo `PERSI_RUNTIME_ENV=staging`) — nenhum rollback de banco/publicação/produção é necessário porque o shadow nunca escreve nada. Condições de rollback imediato: resposta oficial mudou; erro 5xx relacionado; telemetria com PII/segredo; telemetria duplicada; erro do shadow escapando para a resposta; comportamento inesperado do runtime; impossibilidade de observar logs.

### Testes (Seção 13)
`npx tsc --noEmit`: limpo. 126/126 testes diretamente relacionados (shadow runtime, sampling, telemetria, exposability/read-model, database binding, runtime safety gates) reexecutados e verdes nesta rodada — nenhuma falha histórica não relacionada foi tocada.

### Decisão (Seção 14)
```
D2_PREFLIGHT_PASS=YES
SAFE_TO_REQUEST_D2_SHADOW_ENV_ACTIVATION=YES
SAFE_TO_ACTIVATE_SHADOW=NO
```
Condição mínima a resolver antes (ou imediatamente depois) da ativação real: reconfirmar `hosting_getNode_jsRuntimeLogsV1` (Hostinger) funcional, para que a telemetria `console` seja de fato observável — não um blocker de código/segurança, mas um pré-requisito de observabilidade operacional.

---

## A3.6-D2-B — Observabilidade de logs e amostra real de PDPs (read-only, sem ativação)

**Nenhum código de produção foi alterado nesta rodada.** Objetivo: fechar os dois requisitos operacionais citados acima antes de solicitar D2-C.

### Observabilidade de logs (Seção 3)
Uma nova tentativa de reconexão ao `hostinger-hosting` MCP nesta rodada retornou `CONNECT_TIMEOUT` (não insistido mais que uma vez, consistente com 14+ tentativas anteriores desde D1.7). Revisão da evidência histórica (`docs/pim/17`, seção "Isolamento de logs") confirma que `hosting_getNode_jsRuntimeLogsV1` já capturou, uma vez, linhas reais de `console.*` do processo staging real, isoladas de produção. Nenhuma rodada anterior documentou o caminho de navegação manual exato no hPanel.
```
HOSTINGER_SHADOW_LOG_OBSERVABILITY=OPERATOR_CONFIRMATION_REQUIRED
HOSTINGER_LOG_OPERATOR_ACTION=Abrir o hPanel Hostinger -> aplicação Node.js staging.persimateriais.com.br -> tela de Logs, e confirmar que linhas de console.* aparecem ali.
```

### Amostra real de PDPs (Seções 5-7)
Nenhuma fonte segura disponível nesta rodada continha slugs reais (sem cache local de catálogo; leitura Woo Store API bloqueada porque staging lê produção, e "acessar produção" é proibido nesta rodada mesmo em modo leitura). Nenhum slug foi inventado.
```
REAL_SAMPLE_SLUGS_REQUIRE_OPERATOR_INPUT=YES
REAL_SAMPLE_SLUGS_FOUND=0
```
Procedimento local determinístico criado e verificado (script descartável de scratchpad, reutiliza `isSampled()` real, zero requests, zero writes): recebe slugs ou URLs de PDP reais fornecidos pelo operador e calcula localmente quais caem no bucket de 1%. Pronto para uso assim que o operador fornecer 3–10 URLs reais.

### Correção de nomenclatura
O tag real emitido pelo sink console é exatamente `[pim-catalog-shadow]` (não `[pim-shadow]`) — `lib/pim/publication-shadow-telemetry.ts::consolePimShadowTelemetrySink`. Reconfirmado sem segredo/PII/slug no schema do evento (inalterado desde D2-A).

### Gate de ativação (Seção 10)
Nenhuma das duas condições foi totalmente fechada nesta rodada sem ação do operador — por isso:
```
D2B_PASS=NO
SAFE_TO_REQUEST_D2_SHADOW_ENV_ACTIVATION=NO
```
Não é um bloqueio de código/segurança: as duas ações pendentes (abrir a tela de logs no hPanel; fornecer slugs reais) são exclusivamente do operador. Artefato: `scratchpad/a36d2b_staging_log_and_real_sample_qualification.json`, SHA256 `a0da50229da377715419f707b4d51c464b5f6d127f7c2fafbc73034ee5602fbf`.

---

## A3.6-D2-B-R1 — Cálculo de amostra real de PDPs

### Observabilidade de logs — fechada por confirmação do operador
```
HOSTINGER_SHADOW_LOG_OBSERVABILITY=PROVEN
HOSTINGER_RUNTIME_LOG_OPERATOR_CONFIRMED=YES
```
O operador confirmou manualmente, no hPanel de `staging.persimateriais.com.br`, que os logs de runtime Node/Next são visíveis (linhas reais de console e stack traces Next.js observadas). Este agente não re-verificou isso de forma independente (Hostinger MCP segue inacessível) — registrado como evidência humana, mesmo tratamento dado às provas ao vivo de R4/R5. Tag a observar: `[pim-catalog-shadow]`.

Observação não investigada nesta rodada (explicitamente fora de escopo): logs mostraram `StoreApiError` status 500 em staging — não corrigido, não é Woo/env alterado, não é bloqueio de código; fica registrado para uma rodada futura separada, se solicitado.

### Cálculo de amostra real — bloqueado por ausência de dados de entrada
A seção da tarefa reservada para as URLs reais dos produtos (`<COLE AQUI AS URLs DOS PRODUTOS>`) permaneceu como um placeholder de template, literalmente sem nenhuma URL colada. Nenhum slug foi inventado para preencher essa lacuna.
```
REAL_SLUGS_RECEIVED=0
REAL_SLUGS_VALID=0
REAL_SAMPLE_SLUGS_FOUND=0
D2_SAMPLE_ELIGIBLE_SLUGS=[]
NEED_MORE_OPERATOR_SLUGS=YES
```
O calculador local determinístico (`d2b-sample-slug-calculator.mjs`, já criado e testado em D2-B, reutiliza `isSampled()` real) permanece pronto e não foi reexecutado contra nenhum dado real por não haver nenhum para processar. Zero requests de rede, zero leitura Woo, zero escrita, zero acesso a produção, zero alteração de env nesta rodada.

### Gate final
```
D2B_PASS=NO
SAFE_TO_REQUEST_D2_SHADOW_ENV_ACTIVATION=NO
```
Único item pendente agora: o operador reenviar a mesma tarefa com a lista real de URLs/slugs de produtos preenchida. Artefato: `scratchpad/a36d2b_r1_real_pdp_sample_calculation.json`, SHA256 `01cf48fbf4ba378d2e1d5bd4445268f7a36cf7e2fe25a4e550e84c1df674cfd9`.

---

## A3.6-D2-B-R2 — Seleção de amostra real de 1% (7 URLs reais fornecidas)

O operador forneceu 7 URLs reais de PDP (`persimateriais.com.br`, domínio de produção — esperado e válido: a amostragem é uma operação local sobre a string do slug, nunca uma requisição, e o próprio staging lê o catálogo de produção). Slugs extraídos: 7/7 válidos, não vazios, sem duplicatas.

Cada slug foi executado localmente contra `isSampled(slug, 1)` (função real, `lib/pim/publication-shadow-runtime.ts`, não reimplementada), via `d2b-sample-slug-calculator.mjs` (já criado em D2-B, reutilizado sem alteração). Zero requisições HTTP, zero leitura Woo/Supabase, zero acesso a produção/Hostinger, zero alteração de env.

```
chave-de-partida-magnetica-direta-weg-pdw02-075-1cv-220v-4a-trifasica          sampledAt1Percent=false
monitor-de-nivel-clip-clpn-controle-de-enchimento-e-esvaziamento-12vcc-...     sampledAt1Percent=false
tubo-soldavel-cano-pvc-25mm-6m-fortlev                                         sampledAt1Percent=false
tubo-soldavel-cano-pvc-50mm-fortlev-preco-por-metro                            sampledAt1Percent=false
adesivo-bianco-para-argamassa-e-chapisco-pva-balde-com-18-litros-vedacit       sampledAt1Percent=false
argamassa-assentaflex-extra-ac2-cinza-20kg-kerakoll                            sampledAt1Percent=false
refletor-tr-led-slim-30w-6500k-preto-taschibra                                 sampledAt1Percent=false
```

**0 de 7 elegíveis.** Isso é estatisticamente o resultado mais provável por larga margem (probabilidade de zero acertos em 7 tentativas a 1% ≈ 93%) — não é um defeito de `isSampled`/`stableHash`, é o comportamento esperado de uma taxa genuinamente baixa e não manipulável aplicada a um conjunto pequeno. A taxa **não** foi aumentada e nenhum slug foi fabricado para forçar um resultado positivo.

```
REAL_SLUGS_RECEIVED=7
REAL_SLUGS_VALID=7
REAL_SAMPLE_SLUGS_FOUND=0
D2_SAMPLE_ELIGIBLE_SLUGS=[]
NEED_MORE_OPERATOR_SLUGS=YES
D2B_R2_PASS=NO
SAFE_TO_ACTIVATE_SHADOW=NO
```

Observabilidade preservada sem re-derivação: `HOSTINGER_SHADOW_LOG_OBSERVABILITY=PROVEN`, `HOSTINGER_RUNTIME_LOG_OPERATOR_CONFIRMED=YES` (evidência humana de D2-B-R1). `StoreApiError 500` permanece apenas registrado, não investigado — o gate futuro (operador abrir manualmente o PDP elegível em staging com shadow OFF antes da ativação) ainda não se aplica, pois nenhum slug elegível foi encontrado.

Próximo passo: o operador fornecer mais URLs reais (com apenas 1% de taxa, ~30 URLs dariam uma chance próxima de 50% de pelo menos um acerto; 100+ seria consideravelmente mais provável). Artefato: `scratchpad/a36d2b_r2_real_pdp_1pct_sample_selection.json`, SHA256 `61cca2d081c355d779d258563497edb399c453a07d9c19af95591e345db81e7b`.

---

## A3.6-D2-B-R3 — Descoberta via sitemap público e amostra real de 1%

### Sitemap
```
SITEMAP_IMPLEMENTATION=Next.js App Router built-in (app/sitemap.ts), sem sitemap index, sem generateSitemaps (não fragmentado)
PRODUCT_SITEMAP_SOURCE=https://persimateriais.com.br/sitemap.xml
```
Confirmado por leitura local de `app/sitemap.ts`, pela documentação real do Next.js instalado, e por `app/robots.ts` (que já declara esse mesmo `sitemap:`). Um único GET público autorizado nesta rodada: `HTTP 200`, 1.202.993 bytes.

### Extração
`SITEMAP_URLS_READ=3607`. Produtos usam sempre um único segmento (`getProductHref`); categorias/marcas/regiões usam múltiplos segmentos ou prefixo distinto — confirmado por amostragem direta das 502 URLs multi-segmento excluídas (todas categorias aninhadas, ex. `acabamentos/drywall/placas-drywall`). Ambiguidade real: categorias-raiz também usam um único segmento, idêntico em forma a um produto. Resolvida excluindo `RESERVED_ROOT_SLUGS`/páginas institucionais (lidas localmente do código, não adivinhadas) mais uma heurística conservadora (≥5 palavras separadas por hífen E ≥25 caracteres, calibrada pelos 7 slugs reais já confirmados na R2) — 235 slugs curtos/raiz excluídos dessa forma (mistura confirmada de categorias reais e alguns produtos curtos: preferiu-se o lado conservador, zero falso-positivo de categoria classificada como produto).
```
REAL_PRODUCT_URLS_EXTRACTED=2870
REAL_PRODUCT_SLUGS_UNIQUE=2870 (zero duplicatas)
```

### Amostra de 1%
Reutilizada a função real `isSampled()` (`lib/pim/publication-shadow-runtime.ts`), sem reimplementação, via um script novo de extração+filtragem (o calculador da R2 foi desenhado para poucos argumentos manuais, não para filtrar ~3600 URLs de sitemap — mesma função de sampling, script de orquestração diferente). Zero requisições de rede durante o cálculo.
```
SLUGS_EVALUATED_AT_1_PERCENT=2870
REAL_SAMPLE_SLUGS_FOUND=30 (esperado estatisticamente a 1%: ~28,7 — consistente, taxa não manipulada)
```
10 primeiros elegíveis (lista completa das 30 disponível no artefato bruto de extração):
```
abracadeira-condulete-top-pvc-cinza-3-4-para-fixacao-de-eletroduto-tigre
papel-kraft-mascaramento-060x20m-protecao-contra-respingos-de-tinta-salvabras
cabo-flexivel-azul-750v-400-mm-100m-sil
2-tomadas-20a-simples-250v-4x2-jangada-romazi
abracadeira-hidraulica-inca-1-4
forro-pvc-em-regua-frisado-branco-7mm-x-20cm-x-5m
bota-de-seguranca-camurca-marrom-no41-dellani
bota-de-seguranca-couro-vaqueta-preto-no43-dellani
abracadeira-de-nylon-branca-36mmx150mm-com-100-pecas-melfi
escada-articula-de-aluminio-4x3-degraus-sem-plataforma-alumasa
```
Todos: hostname `persimateriais.com.br`, sem query string, sem credencial/token, formato de PDP confirmado, slug não vazio, não é rota administrativa.

### Store API 500 — gate futuro ainda pendente
Não investigado nesta rodada. Nenhum PDP foi aberto automaticamente. Próximo passo (fora desta rodada): o operador abre manualmente um dos PDPs elegíveis em staging (shadow ainda OFF) e confirma que a resposta oficial Woo carrega normalmente.

### Gate final
```
REAL_SAMPLE_GATE_PASS=YES
D2B_R3_PASS=YES
HOSTINGER_SHADOW_LOG_OBSERVABILITY=PROVEN (preservado de D2-B-R1, não re-derivado)
SAFE_TO_ACTIVATE_SHADOW=NO
```
Artefato: `scratchpad/a36d2b_r3_product_sitemap_real_1pct_sample.json`, SHA256 `64aa8aac473c04f01ae9db1ac9ef1af7def57c59fe0dd1e3b36e9a58cb24dd38`.

---

## A3.6-D2-C — Plano de execução da ativação controlada de shadow a 1% (nenhuma alteração de env nesta rodada)

### Evidência de baseline do operador
```
D2_ELIGIBLE_PDP_BASELINE_LOAD=PASS
D2_ELIGIBLE_PDP_BASELINE_SHADOW_MODE=OFF
HOSTINGER_SHADOW_LOG_OBSERVABILITY=PROVEN
```
O operador confirmou manualmente que `https://staging.persimateriais.com.br/abracadeira-condulete-top-pvc-cinza-3-4-para-fixacao-de-eletroduto-tigre` abre normalmente com shadow OFF, e que a tela de logs do hPanel mostra console/runtime Node/Next. Nenhuma dessas duas verificações foi refeita por este agente (não acessei staging/produção nesta rodada).

### Canário principal
```
D2_PRIMARY_CANARY=abracadeira-condulete-top-pvc-cinza-3-4-para-fixacao-de-eletroduto-tigre
D2_PRIMARY_CANARY_SAMPLE_ELIGIBLE=YES
```
Reconfirmado localmente nesta rodada via `isSampled(slug, 1)` real, zero rede.

### Contrato BEFORE → AFTER
```
PERSI_RUNTIME_ENV=staging (inalterado)
PIM_PUBLICATION_MODE: off -> shadow
PIM_SHADOW_SAMPLE_RATE: 0 -> 1
PIM_SHADOW_TELEMETRY_SINK: noop -> console
```
Todas as demais variáveis (`DATABASE_URL`, `APP_BASE_URL`, `WORDPRESS_URL`, `ADMIN_*`, credenciais de Basic Auth/pagamento, qualquer segredo) permanecem intocadas. `PIM_SHADOW_SAMPLE_RATE=1` continua significando exatamente 1% (escala 0-100), reconfirmado nesta rodada sem alteração desde D2-A.

### Prova de efeito (Seção 4 da tarefa) — todas as 11 afirmações comprovadas por código/teste, reexecutados nesta rodada
Somente PDP; somente slugs no bucket de 1%; official permanece Woo; PIM é só observado/comparado; PIM nunca substitui a resposta (retorno `void`); zero publicação (shadow nunca importa `publishBatch`/`unpublishBatch`); zero escrita no banco (somente `SELECT`, shadow read-only por construção); zero chamada a provider (nenhum `fetch`/HTTP em todo o módulo); erro nunca escapa (3 camadas de `try/catch`, testado com timeout/erro de DB/comparador que lança/sink que lança); timeout 500ms preservado; telemetria console estruturada conforme schema documentado. `npx tsc --noEmit` limpo; 126/126 testes diretamente relacionados verdes.

### Telemetria esperada
```
classification=OFFICIAL_ONLY (published=0, evidência por continuidade)
tag=[pim-catalog-shadow]
```
Campos exatos: `productId`, `routeKind`, `classification`, `differenceCount`, `publishedAttributeCount`, `durationMs`, `shadowStatus`, `errorClass` — sem slug (o schema deliberadamente não inclui), sem PII, sem segredo.

### Procedimento manual de ativação (SOMENTE o operador executa)
Aplicação exata: `staging.persimateriais.com.br` (nunca `persimateriais.com.br`). No editor de variáveis de ambiente do hPanel: alterar SOMENTE `PIM_PUBLICATION_MODE=shadow`, `PIM_SHADOW_SAMPLE_RATE=1`, `PIM_SHADOW_TELEMETRY_SINK=console`, uma de cada vez; confirmar `PERSI_RUNTIME_ENV=staging` intocada; confirmar todas as demais variáveis intocadas; salvar/aplicar (o próprio hPanel reinicia o processo). Nenhum deploy de código é necessário.

### Validação imediata AFTER
Abrir Home staging → confirmar Basic Auth → confirmar Home carrega → abrir o MESMO PDP canário → confirmar que carrega normalmente → abrir logs do hPanel → procurar `[pim-catalog-shadow]` → esperar exatamente uma emissão com `classification=OFFICIAL_ONLY` (ausência de campo `slug` no evento é esperada, não é defeito).

### Gates definidos
```
RESPONSE_INVARIANCE_GATE_READY=YES
LOG_GATE_READY=YES
ROLLBACK_READY=YES
```
Invariância: comparar HTTP/sucesso, identidade do produto, preço, estoque, atributos oficiais, canonical e dados estruturados relevantes entre BEFORE (confirmação do operador já feita) e AFTER — não byte-idêntico. Qualquer mudança material atribuível ao shadow → rollback imediato. Log gate: tag aparece, `classification=OFFICIAL_ONLY`, sem PII/segredo, sem evento duplicado, sem stack trace escapando, sem unhandled rejection — se a tag não aparecer, **não aumentar sampling**, investigar primeiro se o restart/env realmente foi aplicado.

### Rollback
Reverter somente env (`PIM_PUBLICATION_MODE=off`, `PIM_SHADOW_SAMPLE_RATE=0`, `PIM_SHADOW_TELEMETRY_SINK=noop`), mantendo `PERSI_RUNTIME_ENV=staging` — sem rollback de banco/código/publicação.

### Gate final
```
D2C_PLAN_PASS=YES
SAFE_FOR_OPERATOR_TO_ACTIVATE_1PCT_SHADOW_ON_STAGING=YES
SAFE_TO_PUBLISH=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_PRODUCTION=NO
SAFE_TO_EXECUTE_ANY_STAGING_DB_WRITE=NO
```
Esta autorização cobre SOMENTE a alteração manual das 3 variáveis pelo operador — nenhuma env foi alterada por este agente nesta rodada. Artefato: `scratchpad/a36d2c_controlled_1pct_shadow_activation_plan.json`, SHA256 `646c1fb5ca7abe363ff59034b512d7fdb1a4b48fe0c282fd13f38cba60ee94cb`.

---

## A3.6-D2-C-R1 — Root cause do disparo quádruplo de telemetria (rollback já confirmado pelo operador)

### O que aconteceu
O operador ativou manualmente `shadow`/`1`/`console` em staging. O canário `abracadeira-condulete-...` continuou carregando normalmente, mas o runtime produziu **4 eventos `[pim-catalog-shadow]`** para o mesmo `productId`, quase simultâneos (durações 161–172ms), todos `classification=OFFICIAL_ONLY`/`shadowStatus=completed`/`errorClass=null`. Conforme o próprio gate da D2-C, o operador executou rollback (`off`/`0`/`noop`, `PERSI_RUNTIME_ENV=staging` preservado) — `ROLLBACK_OPERATOR_CONFIRMED=YES`.

### Causa raiz (comprovada por leitura direta de código, não inferência)
`getProductBySlug` (`services/woocommerce/products.ts`) era chamado **4 vezes independentes** para uma única requisição lógica de PDP, sem nenhuma memoização com escopo de request em nenhum ponto da cadeia:
```
PDP request
 ├─ app/[...segments]/page.tsx :: generateMetadata
 │   └─ resolvePublicRoute → getProductBySlug()          [chamada #1]
 │       └─ delega para product-page.tsx :: generateMetadata
 │           └─ getProductBySlug()                        [chamada #2]
 └─ app/[...segments]/page.tsx :: PublicPage (default)
     ├─ resolvePublicRoute → getProductBySlug()           [chamada #3]
     └─ renderiza <ProductPage> :: product-page.tsx
         └─ getProductBySlug()                             [chamada #4]
```
Cada uma das 4 chamadas reexecuta o corpo inteiro de `getProductBySlug`, inclusive o efeito colateral `scheduleProductShadow(product)` — cada execução é corretamente single-fire (o guard `emitted` de `observeOnce` funciona), mas nenhuma tem visibilidade das outras 3. **`DUPLICATE_KIND=MULTIPLE_EXECUTIONS`**, não múltiplas emissões de uma única execução (hipótese B/C descartadas — o guard de disparo único permanece correto e intocado, 135/135 testes reconfirmados verdes).

Confirmado por grep: zero uso de `React.cache()`/`unstable_cache` em toda a cadeia antes desta rodada.

### Reprodução local
```
LOCAL_DUPLICATE_REPRODUCED=YES
LOCAL_EXECUTION_COUNT=4
LOCAL_TELEMETRY_COUNT=4
```
Reproduzido chamando o `runPimCatalogShadow` real (código de produção inalterado) 4 vezes com deps injetadas (zero rede/DB), replicando a multiplicidade real encontrada — resultado bate exatamente com a observação ao vivo.

**Limitação de teste documentada**: `React.cache()` não memoiza fora de um render RSC ativo — confirmado empiricamente (chamado 2x fora de um render real, executa 2x). Isso é uma limitação do ambiente de teste local (Node puro, sem o runtime de renderização do Next), não uma evidência contra a correção, que segue exatamente o padrão oficial documentado pelo próprio Next.js para este cenário (`generateMetadata` + página precisando do mesmo dado). Confirmação end-to-end completa requer uma requisição real dentro do Next.js — não realizada nesta rodada (exigiria leitura real de produção) — fica para uma rodada futura de reativação controlada.

### Unidade semântica escolhida
Uma observação de shadow por requisição HTTP lógica de PDP — não por chamada interna, não por debounce temporal, não por `Map`/`Set` global de processo (rejeitados explicitamente: Hostinger pode rodar múltiplas instâncias, um cache global de processo seria inconsistente entre instâncias, cresceria sem limite e poderia mascarar mudanças reais de publicação).

### Correção aplicada
`services/woocommerce/products.ts::getProductBySlug` envolvida em `React.cache()` (uma linha de import + wrap da função) — escopo por request, nunca cross-request, nunca compartilhado entre processos/instâncias do Hostinger; não muda o que a função retorna a nenhum chamador; colapsa automaticamente as 4 chamadas reais em uma única execução por request (inclusive o efeito `scheduleProductShadow`), sem tocar `resolvePublicRoute`, `page.tsx` ou `product-page.tsx` individualmente. Teste pré-existente (`pimA36BOfficialResponseInvariance.test.mjs`) ajustado apenas no localizador de texto-fonte (mesma asserção). Novo arquivo `tests/pimA36D2CR1DuplicateShadowExecutionFix.test.mjs` (9 testes): prova estrutural da correção, topologia da causa raiz, limitação de teste documentada, reprodução do mecanismo pré-correção, regressão de chamada única, isolamento entre produtos diferentes.

### Testes
```
tests/pimA36D2CR1DuplicateShadowExecutionFix.test.mjs: 9/9 PASS
Conjunto diretamente relacionado: 135/135 PASS (126 + 9 novos)
npm run test:pim: 656/656 PASS (647 + 9 novos)
npx tsc --noEmit: limpo
npm run build: sucesso
tests/instagramFeed.test.mjs: única falha histórica não relacionada, confirmada inalterada, não corrigida
```

### Riscos remanescentes (registrados, não resolvidos nesta rodada)
`getProductNavigation` (produto anterior/próximo) também chama `getProductBySlug` para slugs DIFERENTES do produto atual — pode legitimamente agendar shadow para até 2 produtos adicionais por render de PDP, se elegíveis na amostra. Isso não é o defeito de telemetria duplicada (produtos diferentes, eventos distintos e corretos), mas fica registrado para consciência futura. A rota de quick-view (`/api/catalog/products/[slug]`) é uma requisição genuinamente separada — comportamento correto, não afetado por esta correção.

### Gate final
```
ROOT_CAUSE_PROVEN=YES
DUPLICATE_EXECUTION_CORRECTED_LOCALLY=YES
SINGLE_FINAL_EVENT_TEST_PASS=YES
D2C_R1_PASS=YES
SAFE_TO_REACTIVATE_SHADOW=NO
```
Próximo passo: uma rodada futura, separadamente autorizada, deve reativar brevemente o shadow a 1% em staging e confirmar ao vivo que agora aparece exatamente 1 evento `[pim-catalog-shadow]` por requisição real de PDP, antes de qualquer ativação mais ampla/duradoura. Artefato: `scratchpad/a36d2c_r1_duplicate_shadow_root_cause.json`, SHA256 `41ef3fccbbacd3ecbf5981bfe606705018901ca1ff30c2f5d3ecb4a4b0f5d4c6`.
