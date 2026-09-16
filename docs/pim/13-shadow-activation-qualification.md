# PIM Shadow Activation Qualification (A3.6-C)

**Esta rodada é qualificação, não ativação.** Nenhuma variável de ambiente foi alterada em nenhum lugar; `PIM_PUBLICATION_MODE` e `PIM_SHADOW_SAMPLE_RATE` continuam não-setados em todo ambiente real.

## A. Contrato de configuração

| Variável | Valores aceitos | Default | Comportamento em valor inválido |
|---|---|---|---|
| `PIM_PUBLICATION_MODE` | `"off"` \| `"shadow"` \| `"canary"` (comparação estrita, case-sensitive) | `"off"` | Qualquer outro valor (incluindo `"SHADOW"`, `" shadow "`, string vazia, ausente) → `"off"` — negação por padrão |
| `PIM_SHADOW_SAMPLE_RATE` | número **0–100** (percentual) | `0` | `NaN`, negativo, ausente, vazio, whitespace → `0`. Acima de 100 → clampado em `100`, nunca acima |

**Unidade do sample rate é canonicamente 0–100 (percentual), nunca 0–1.** Isso elimina a ambiguidade explicitamente citada na tarefa: o valor `"1"` significa **1%**, nunca 100%. Testado em `tests/pimA36CShadowActivationQualification.test.mjs`.

`mode="shadow"` sozinho **não** liga nenhuma observação real — o sample rate default `0` garante isso mesmo que alguém defina `PIM_PUBLICATION_MODE=shadow` sem também definir `PIM_SHADOW_SAMPLE_RATE`. Os dois knobs precisam ser ligados deliberadamente.

### Matriz de configuração (Seção 7)

| mode | sample | PIM_READ_ALLOWED | SHADOW_OBSERVATION_ALLOWED | CANARY_OUTPUT_ALLOWED |
|---|---|---|---|---|
| ausente/inválido | qualquer | false | false | **false** |
| off | qualquer | false | false | **false** |
| shadow | 0 (default) | false | false | **false** |
| shadow | 1–100 | true | true | **false** |
| canary | qualquer | true (mesmo caminho do shadow) | true | **false** |

`CANARY_OUTPUT_ALLOWED` permanece **false em toda execução real** — `runPimCatalogShadow`/`runPimCatalogShadowForList` são sempre `void`, nunca retornam nada que possa influenciar a resposta, independentemente do `mode`.

## B. Sink de telemetria — auditoria e contrato

Auditado antes de criar qualquer coisa: **nenhuma dependência de observabilidade existe no projeto** (`package.json` não tem Sentry, OpenTelemetry, Winston, Pino, Datadog, Logtail, Axiom). A única convenção existente é `console.info("[tag]", event)`, já usada pelo shadow Woo-vs-Postgres pré-existente (`services/catalog/productShadow.ts`) e por vários serviços WooCommerce. Hostinger já expõe logs de runtime Node.js (`hosting_getNode_jsRuntimeLogsV1`) como ponto de coleta existente — nenhum serviço novo é necessário para tornar um sink baseado em console observável no ambiente de hospedagem real.

`lib/pim/publication-shadow-telemetry.ts`:
- `PimShadowTelemetrySink { emit(event): Promise<void> | void }` — contrato, o runtime nunca conhece a implementação concreta.
- `noopPimShadowTelemetrySink` — default atual do runtime (nenhum destino real ligado ainda).
- `consolePimShadowTelemetrySink` — adapta a convenção existente, disponível para uma futura ativação escolher explicitamente.
- `createCollectingTelemetrySink()` — helper de teste.
- `toTelemetryFunction(sink)` — adapta o sink de objeto para a forma de função usada internamente, com proteção defensiva contra `throw` síncrono e promise rejeitada.

### Isolamento de falhas de telemetria (Seção 10)

Duas camadas independentes de proteção: `toTelemetryFunction` protege na borda do adaptador; o próprio `emit()` do orchestrator protege novamente (defesa em profundidade). Provado por teste: sink que lança síncrono, sink cuja promise rejeita — nenhum dos dois gera exceção não tratada (`unhandledRejection`) nem impacta a resposta oficial.

## C. Schema de evento (congelado)

```
PimCatalogShadowTelemetryEvent {
  productId: string | null       // uuid interno PIM, nunca identificador de cliente
  routeKind: "product" | "category" | "search"
  classification: string          // rótulo agregável, baixa cardinalidade
  differenceCount: number
  publishedAttributeCount: number
  durationMs: number
  shadowStatus: ShadowStatus
  errorClass: string | null       // nome de construtor normalizado ou "timeout"/"unknown", NUNCA stack trace
}
```

Campos proibidos (testado por regex negativo): nome de cliente, e-mail, telefone, CPF/CNPJ, endereço, cookies, headers de autenticação, IP, session ID, tokens, `DATABASE_URL`, linhas cruas de banco, descrição completa do produto.

### Segurança de log injection

Uma string adversária no `slug` (incluindo sequências ANSI e um template literal simulando `${process.env.DATABASE_URL}`) é carregada como valor de campo opaco — nunca interpolada em string de formato, nunca avaliada. `errorClass` é sempre normalizado (`error.constructor.name` ou `"timeout"`/`"unknown"`), nunca a stack trace completa.

## D. Sampling determinístico

`isSampled(key, percent)` usa FNV-1a (`stableHash`). Provado nesta rodada com dataset sintético:
- Mesmo slug → mesma decisão em 1000 chamadas repetidas.
- 10.000 slugs sintéticos distintos a 30% → ~30% amostrados (banda 25–35%, sem viés/quebra).
- 0% → ninguém; 100% → todos.
- Chave é sempre o `slug` do produto (nunca customer/session/IP) — sampling por **produto**, não por pessoa.

## E. Qualificação runtime (positiva, divergência, off, zero-sample, timeout, after())

Todas provadas por teste offline nesta rodada (`tests/pimA36CShadowActivationQualification.test.mjs`, `tests/pimA36BShadowRuntime.test.mjs`):
- **off**: zero chamadas a `resolvePimProductId`/`fetchPublishedAttributes`/`compare`.
- **sample=0**: idem — sampling ocorre **antes** de qualquer trabalho caro, nunca depois.
- **timeout**: fast/near-budget/over-budget/never-resolving — timeout dispara no máximo uma vez; conclusão tardia do trabalho abandonado não gera segunda telemetria (guarda de disparo único, já corrigida na A3.6-B e reconfirmada aqui).
- **after()/fallback**: `scheduleWithAfter` sem scheduler injetado (caminho real de produção) executa exatamente uma vez, sem lançar, fora de um contexto de requisição real (ambiente de teste) — usa o fallback fire-and-forget com segurança.

## F. Qualificação read-only em staging

Staging permanece `rolled_back` (`published=0`, `unpublished=8`). Rodando o orchestrator real contra os 8 identities históricos: todos retornam `publishedAttributeCount=0`, exatamente 1 evento cada (8 total, sem duplicação). BEFORE/AFTER de `pim_publication_batches`, `pim_attribute_publications`, `product_attribute_values`, `attribute_values`, `pim_audit_log`, `pim_attribute_reviews`, `pim_attribute_decisions`, `pim_conflicts` — todos idênticos. **Zero escritas.**

## G. Invariância do contrato PDP

O objeto `Product` (Woo) passado para `scheduleProductShadow` permanece byte-a-byte idêntico após uma execução completa; sua forma serializada nunca contém `classification`, `candidate`, `batchId`, `publicationState`, `differenceCount` ou `shadowStatus`.

## H. Guarda de escopo (listing/search)

Reconfirmado: `git grep` por `runPimCatalogShadow` em `app`/`components` retorna vazio. Apenas PDP conectada.

## I. Invariância de cache

Nenhuma cache key, TTL ou `revalidate`/`revalidateTag` oficial foi tocada nesta rodada. O shadow roda inteiramente depois que o valor oficial já foi computado.

## J. NEEDS_REVIEW

Confirmado no runtime: mesmo com um candidate fixture tentando publicar `comprimento` para os SKUs do registry, a classificação resultante é `BLOCKED`, nunca um sinal de "publicável". Nenhuma escrita estrutural em staging nesta rodada.

## K. Separação do advisory lock

Provado por teste: nenhum arquivo do caminho de leitura/shadow (`publication-read-model.ts`, `publication-shadow-runtime.ts`, `publication-candidate.ts`, `publication-shadow-comparison.ts`) referencia `pg_advisory_xact_lock`/`withPublicationLock`, nem importa `publishBatch`/`unpublishBatch`. O shadow é estruturalmente incapaz de adquirir o lock de escrita.

---

## L. RUNBOOK de ativação futura (NÃO EXECUTADO NESTA RODADA)

Este runbook é uma especificação para uma **rodada separada e explicitamente autorizada** (A3.6-D ou posterior). Nada aqui foi executado.

### L.1 Variáveis de ambiente exatas

```
PIM_PUBLICATION_MODE=shadow
PIM_SHADOW_SAMPLE_RATE=<inteiro 0-100>
```

Nenhuma outra variável é necessária para o shadow observacional.

### L.2 Sample rate inicial recomendado

**1** (1%). Justificativa técnica: o menor valor não-zero que ainda produz sinal estatístico observável em volume razoável de tráfego de PDP, minimizando superfície de qualquer efeito colateral não previsto durante a primeira janela de observação real. Não é uma meta de negócio — é o menor incremento acima de zero.

### L.3 Janela de observação

Recomendado: mínimo 24–48h de tráfego real de PDP antes de qualquer decisão de aumentar o sample rate, para capturar variação diária de tráfego.

### L.4 Métricas/gates a observar durante a janela

- `shadowStatus` distribuição (proporção `completed` vs `timeout` vs `error`).
- `differenceCount`/`classification` distribuição (quantos `MATCH` vs divergências).
- Nenhuma correlação entre ativação do shadow e qualquer aumento de latência/erro da PDP (a ser confirmado via métricas de aplicação já existentes, fora do escopo desta rodada).

### L.5 Condições de aborto

- Qualquer aumento mensurável de latência de PDP atribuível à ativação.
- Qualquer erro 5xx de PDP correlacionado temporalmente com a ativação.
- `unhandledRejection` observado nos logs do runtime Node.js.
- Qualquer evidência de telemetria duplicada por requisição.

### L.6 Rollback

```
PIM_PUBLICATION_MODE=off
```

Definir e reiniciar o processo Node.js (Hostinger) é suficiente — `mode=off` é checado antes de qualquer acesso ao PIM (Seção 17), portanto remove 100% da leitura do PIM imediatamente após o próximo request processado pelo processo reiniciado.

### L.7 Pré-requisitos confirmados nesta rodada

- Nenhuma publicação é necessária para ativar o shadow — staging pode permanecer com `published=0` (o shadow prova comparação mesmo com candidate vazio: `OFFICIAL_ONLY` para tudo, sem erro).
- Para comparar **conteúdo PIM positivo** em ambiente real (não apenas infraestrutura), será necessária uma fase **separada e distinta** com um canário de publicação autorizado — explicitamente **não deve ser misturada** com a ativação do shadow.
- Confirmação de invariância de resposta: repetir a Seção G (contrato PDP) contra uma amostra real de produtos em staging após a ativação, antes de considerar produção.

## M. Pré-requisitos para a próxima fase

1. Escolher e configurar de fato um sink de telemetria (Console é o candidato mais simples e já qualificado; ou uma decisão explícita por outra ferramenta).
2. Executar o runbook acima em um ambiente controlado, com autorização própria e separada.
3. Resolver o backlog estrutural de NEEDS_REVIEW antes de qualquer expansão de escopo além de PDP.
4. Decidir separadamente sobre uma fase de canário de publicação real, se o objetivo for validar conteúdo PIM positivo (não apenas infraestrutura).
