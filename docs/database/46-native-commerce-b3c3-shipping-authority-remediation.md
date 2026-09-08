# B.3-C3-P3-C-R1D - Shipping authority remediation

Data: 2026-09-05. Escopo estritamente local/offline.

## Auditoria e decisão

`shipping_quote_cache` contém JSON mutável e serve apenas como cache; não foi
promovido a autoridade. A cotação anterior aceitava fingerprint e versão do
caller e readiness verificava somente seu formato.

A remediation local cria evidência append-only vinculada a checkout, store,
destino, moeda, valor, provider/serviço, inputs logísticos e expiração. O
fingerprint canônico é calculado no PostgreSQL. `logistics_version` identifica
o contrato de normalização e fica fixada em `shipping-authority-v1`. Criação e
substituição são primitives server-only; readiness continua sem rede. Checkout
sem shipping continua dispensado.

## Hard stop do primeiro rebuild

A migration local `20260905130000_checkout_shipping_authority.sql` foi criada.
O único reset autorizado falhou com SQLSTATE `42830`: a FK
`(shipping_evidence_id, checkout_session_id)` não encontrava unique constraint
exatamente compatível.

A fonte foi corrigida adicionando unicidade `(id, checkout_session_id)`, mas
nenhum segundo reset foi executado. A migration corrigida ainda não foi validada
desde zero; pgTAP focado, runtime, concorrência e regressão permanecem pendentes.
Não houve acesso remoto, deploy, commit ou push.

## R1D-R2 - static-review hard stop

A auditoria pré-reset confirmou 28 arquivos, histórico local 27, última migration
`20260905020000` e ausência completa de objetos parciais da migration 28. As FKs
são sintática e semanticamente coerentes após a inclusão de `UNIQUE (id,
checkout_session_id)`: a cotação não pode referenciar evidência pertencente a
outro checkout.

Antes de consumir o reset adicional, a revisão encontrou um defeito
determinístico: `canonical_checkout_logistics_fingerprint` está declarada
`STRICT`, embora `shipping_method_id`, `estimated_delivery_days` e
`provider_quote_reference` sejam opcionais. Quando qualquer argumento é `NULL`,
PostgreSQL não executa a função e retorna `NULL`, incompatível com
`canonical_fingerprint NOT NULL`. Uma evidência legítima sem esses opcionais
falharia antes do runtime.

Blocker: `R1D_CANONICAL_FINGERPRINT_NULLABLE_INPUT_STRICT`. Conforme a política
R1D-R2, nenhum reset foi tentado nesta retomada e a migration não foi alterada
automaticamente. O hash observado permaneceu
`6049f5367c7dbb665dee4d50be4c53ebbb3f358bde308cf76a8bceb3a6d73cff`.

## R1D-R2A NULL-SAFE FINGERPRINT STATIC REMEDIATION

O `STRICT` foi removido. Os campos obrigatórios são evidence/checkout/store ID,
provider, código externo, carrier, service, amount minor, currency, postcode,
destination fingerprint, logistics-inputs fingerprint, logistics version,
quoted-at e expires-at. Eles falham explicitamente com
`INVALID_SHIPPING_FINGERPRINT_INPUT` quando ausentes ou semanticamente vazios.

Os opcionais são `shipping_method_id`, `estimated_delivery_days` e
`provider_quote_reference`. O preimage passou a ser um array JSONB ordenado de
pares `[nome, valor]`; JSON null é preservado e difere de string vazia e zero.
UUIDs usam representação canônica, dinheiro permanece BIGINT, timestamps são
entradas explícitas normalizadas em UTC com microssegundos e cada campo mantém
fronteira e tipo próprios. Provider/service/carrier são normalizados na criação
e o contrato de versão continua fixo em `shipping-authority-v1`.

A helper é usada tanto na criação quanto na recomputação de readiness e nenhum
caller fornece o digest canônico. Sua volatilidade correta é `STABLE`: não lê
tabelas, configurações nem relógio, mas usa `to_char(timestamp, ...)`, cuja
volatilidade PostgreSQL não permite afirmar `IMMUTABLE` com rigor.

A revisão também tornou idempotência fail-closed para payload divergente e
removeu o hardcode indevido de BRL; a moeda continua derivada do checkout. A FK
composta e `UNIQUE (id, checkout_session_id)` permanecem semanticamente
corretas. RLS, revokes, primitives server-only, append-only e optionalidade de
shipping foram preservados. Testes estáticos focados: 3/3 PASS. Nenhum outro
`STRICT` inseguro foi encontrado.

Hash anterior: `6049f5367c7dbb665dee4d50be4c53ebbb3f358bde308cf76a8bceb3a6d73cff`.
Hash novo: `187867d694e77da9f6f06f01d789cb9a771a93ba5aa04931b226c86b9a7ffd52`.
Nenhum reset ou aplicação manual foi executado; PostgreSQL runtime permanece
pendente para a próxima autorização de rebuild.

## R1D-R2B AUTHORIZED REBUILD - SQL PARSER HARD STOP

O gate pré-reset confirmou Docker/PostgreSQL saudáveis, histórico 27, ausência
de objetos parciais e os cinco hashes aprovados. O único reset autorizado foi
consumido. A aplicação chegou à migration 28 e falhou com SQLSTATE `42601` em
`create_native_shipping_evidence`.

A expressão de idempotência `IS DISTINCT FROM CASE ... END` não foi aceita pelo
parser no contexto PL/pgSQL. Conforme a política R2B, não houve correção nem
retry nesta execução. O rollback foi completo: histórico continua 27, última
migration `20260905020000`, e tabela, funções, trigger e policies R1D continuam
ausentes. Runtime, pgTAP pós-migration, concorrência e regressão não foram
executados. Nenhum acesso remoto ou chamada de provider ocorreu.

## R1D-R2C TRANSACTIONAL PRE-APPLY VALIDATION

O blocker `42601` foi corrigido agrupando explicitamente o `CASE` usado por
`IS DISTINCT FROM`, preservando as quatro combinações NULL-safe. A revisão
confirmou normalização simétrica entre INSERT, comparação idempotente,
fingerprint e readiness.

A migration completa foi copiada byte a byte para um arquivo temporário do
contêiner e executada uma única vez dentro de `BEGIN`/`ROLLBACK`. PostgreSQL
aceitou tabela, constraints, índice, cinco funções, trigger, RLS e grants. Os
smokes confirmaram: opcionais nulos produzem digest não nulo; mandatory-null
falha fechado; amount altera o digest; criação com opcionais nulos funciona;
repetição normalizada é idempotente; payload divergente conflita; UPDATE é
rejeitado; anon não possui INSERT nem EXECUTE.

O rollback concluiu com histórico 27, última migration `20260905020000`, zero
objetos R1D e zero fixtures. A cópia temporária foi removida. Nenhum reset foi
executado.

Hash anterior: `187867d694e77da9f6f06f01d789cb9a771a93ba5aa04931b226c86b9a7ffd52`.
Hash corrigido: `7d938dc2578aef9fac8c82058ea2a3dd7280546a9de0e9e52f6cd9cd3a39d45c`.
Este hash ainda depende de rebuild e runtime completos para se tornar canônico.

## R1D-R2D — rebuild final e validação runtime (2026-09-05)

O único rebuild autorizado nesta fase foi executado com o guard offline ativo e
aplicou as 28 migrations. O histórico terminou em `20260905130000`. A migration
28 passou a ter como hash canônico
`7d938dc2578aef9fac8c82058ea2a3dd7280546a9de0e9e52f6cd9cd3a39d45c`.
Nenhum retry, acesso remoto ou migration 29 ocorreu.

A validação PostgreSQL confirmou a tabela append-only de evidências, funções
server-only, trigger, constraints, FK composta, índices, RLS sem policy pública
e revogação para papéis de browser. O schema Drizzle foi alinhado à tabela e à
FK composta `(shipping_evidence_id, checkout_session_id)`.

O registry runtime executou 9/9 cenários obrigatórios, sem lacunas: evidência
ausente; adulteração de fingerprint, versão, valor, moeda, provedor, serviço e
destino; e expiração. Todos falharam fechado, enquanto o happy path terminou em
`ready`. O completeness guard e seu autoteste negativo também passaram.

pgTAP focado: 20/20. pgTAP completo e pós-cleanup: 508/508. Concorrência:
price/readiness 50 ciclos, PII/readiness 50 ciclos, inventory 50 ciclos,
checkout 20 ciclos/220 execuções e order 20 ciclos/360 execuções; zero
overselling, stale-ready, duplicidade, deadlock, timeout ou lost update.

O gate específico de concorrência replacement/readiness foi concluído na
retomada R1D-R2E descrita abaixo.

A regressão offline passou em typecheck, lint (zero erros, cinco warnings) e
build. `npm test` preservou o único baseline não relacionado do Instagram:
666/667. O guard bloqueou 109 tentativas Woo e uma tentativa Instagram;
requisições externas efetivamente enviadas: zero. Todas as fixtures retornaram
ao baseline por rollback/cleanup verificado.

## R1D-R2E — replacement × readiness concurrency closure (2026-09-05)

O harness dedicado
`scripts/database/shipping-replacement-readiness-concurrency.mjs` usa três
backends PostgreSQL distintos: setup/auditoria, replacement e readiness. Em
cada ciclo, uma Promise-barrier libera simultaneamente duas transações com
conexões independentes. A conexão A cria uma evidência B legítima e instala a
quote B pela primitive autoritativa; a conexão B executa
`mark_native_checkout_ready`. Cada uma das 50 corridas usa checkout, catálogo,
preço, reserva, PII e evidências A/B sintéticos próprios.

Resultado final: 50/50 ciclos completos; readiness/A venceu 45 vezes;
replacement/B venceu 5 vezes; houve 45 rejeições seguras por estado e 5 casos
em que replacement e readiness retornaram sucesso coerente. O validador
pós-corrida releu quote e evidence, recomputou o fingerprint canônico e comparou
checkout, store, destination, currency, amount, provider, service, carrier,
shipping method, delivery days, provider reference, logistics inputs/version e
expiração.

Resultados inválidos: mixed-ready 0, tampered-ready 0, wrong-destination-ready
0, ready sem evidência 0, ready com evidência expirada 0, cross-checkout 0 e
cross-store 0. Deadlocks, timeouts, lost updates, erros inesperados,
overselling e duplicidades: 0.

Durante as corridas, os deltas de on-hand, reserved, novos movimentos de
reserva, movimentos de venda, pedidos, itens de pedido, PII e snapshots de
preço foram todos zero. A reserva inicial continuou usando a semântica normal
de `reserve_inventory` antes da fotografia da corrida.

S0 e S1 foram idênticos: somente as duas price lists e a inventory location de
seed permaneceram; todas as tabelas de fixtures relevantes retornaram a zero.
A primeira injeção controlada revelou que evidências precisavam ser removidas
explicitamente antes da limpeza com triggers de RI desativados. A correção foi
restrita ao harness. A segunda execução da injeção reportou
`EXPECTED_R1D_R2E_INJECTED_FAILURE`, `FIXTURE_CLEANUP_PASS` e igualdade S0/S1.

O pgTAP antes e depois do harness passou 508/508. A regressão focada passou
21/21, typecheck e `git diff --check` passaram. Nenhuma migration, função,
schema Drizzle, runtime de checkout, código de produção ou helper compartilhado
foi alterado nesta fase. Requisições externas reais: zero.

Os hashes protegidos permaneceram inalterados; migration 28 continua canônica
em `7d938dc2578aef9fac8c82058ea2a3dd7280546a9de0e9e52f6cd9cd3a39d45c`.
Com este gate, R1D está completa e é seguro solicitar autorização separada para
reiniciar R1B-R3.
