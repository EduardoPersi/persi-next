# B.3-C3-P3-C — Integrated validation final restart

Data: 2026-09-04. Resultado: hard stop no pgTAP baseline, antes da criação ou execução do harness integrado.

## Baseline imutável

- migrations locais: 25 arquivos e 25 registros;
- P3-A SHA-256: `a4ae5198f74af785154ba6275d3631be1950616c7a2a34425f168a240e8ab32d`;
- P3-B SHA-256: `12aabf11350cf0b3b58d886994b4daa127aac59e8f694fb42f5c41a3433d3459`;
- Docker Engine: 29.7.2, responsivo;
- PostgreSQL local: `127.0.0.1:15422`, container `healthy`;
- tax crypto isolado P3-C0-TAX: aprovado anteriormente;
- correção semântica do ledger de inventory: aprovada anteriormente;
- bloqueio de porta Windows: resolvido pela fase P3-C-OPS-D3.

## Falha do gate pgTAP

O pgTAP completo obrigatório, executado antes do harness, não reproduziu o baseline 452/452. O runner processou 440 assertions antes das interrupções e reportou falhas em:

- `core_catalog_pim_pricing_inventory.test.sql`: subquery com mais de uma linha e contagem GTIN global 184 em vez de 1; o arquivo encerrou antes de completar o plano;
- `native_checkout_foundation.test.sql`: sete falhas por contagens globais e seleções sem escopo encontrarem sessions, reservations, quotes e carts preexistentes;
- `native_checkout_order_integrity_hardening.test.sql`: contagem global de movements 171 em vez de 0.

Todos os 13 arquivos pgTAP possuem `BEGIN` e `ROLLBACK`, portanto eles não são a origem dos resíduos. A auditoria read-only do banco encontrou:

| Tabela | Linhas sintéticas/preexistentes |
|---|---:|
| products | 182 |
| product_variants | 184 |
| carts | 160 |
| checkout_sessions | 108 |
| inventory_reservations | 147 |
| inventory_movements | 171 |
| orders | 20 |
| order_items | 0 |

Os resíduos foram produzidos pelos validadores locais executados depois do reset limpo da fase D3:

- `phase-c-validation.mjs` não remove suas fixtures no `finally`;
- `inventory-concurrency.mjs` não remove seus 50 ciclos e burst;
- `native-checkout-concurrency.mjs` não possui cleanup final das fixtures por ciclo;
- `native-order-concurrency.mjs` não remove carts, checkouts, orders e stores criados.

Essa combinação torna o pgTAP dependente de banco vazio quando possui assertions de contagem global. O primeiro pgTAP imediatamente após o reset D3 passou 452/452; o rerun depois das regressões D3 falhou devido ao estado residual. Não há evidência de migration SQL quebrada.

## Classificação

- `P3C_BLOCKER_FOUND = YES`;
- blocker: `LOCAL_VALIDATION_FIXTURE_ISOLATION_FAILURE`;
- migration/schema blocker: não;
- schema change requerida: não demonstrada;
- harness integrado criado: não;
- harness integrado executado: não;
- reset corretivo executado: não;
- staging acessado: não.

O próximo passo deve ser uma fase corretiva offline que torne os validadores locais isolados e repetíveis (transação com rollback ou cleanup determinístico), seguida de reset local explicitamente autorizado e dois ciclos consecutivos de regressão + pgTAP. Somente depois P3-C pode reiniciar desde o hash gate.

## Gates desta execução

- `P3C_HASHES_VALID = YES`;
- `P3C_LOCAL_DATABASE_VALID = YES` no health/migration gate;
- `P3C_PGTAP_PASS = NO`;
- demais gates integrados P3-C: não executados e não aprovados;
- `NEW_SCHEMA_CHANGE_REQUIRED = NO` com a evidência atual;
- `C3_PREREQUISITES_COMPLETE = NO`;
- `SAFE_TO_DEPLOY_P3_MIGRATIONS_TO_STAGING = NO`;
- `NATIVE_RUNTIME_ENABLED = NO`;
- `STAGING_WRITES_ZERO = YES`;
- `PRODUCTION_ACCESSED = NO`.

## LOCAL FIXTURE ISOLATION REMEDIATION

Data: 2026-09-05. Escopo exclusivamente local/offline. O blocker
`LOCAL_VALIDATION_FIXTURE_ISOLATION_FAILURE` foi corrigido sem migration ou mudanca de
schema. O harness integrado P3-C nao foi criado nem executado.

### Causa e mapa de mutacoes

Os quatro validadores criavam fixtures persistentes sem um owner de execucao e sem
cleanup em `finally`:

- `phase-c-validation.mjs`: catalogo/PIM, categorias, pricing, inventory e external mappings;
- `inventory-concurrency.mjs`: produtos, variantes, locations, levels, reservations e movements;
- `native-checkout-concurrency.mjs`: stores, carts, checkout sessions/items/quotes, pricing e inventory;
- `native-order-concurrency.mjs`: stores, carts, checkout sessions, orders e status events.

Foi criado `scripts/database/fixture-isolation.mjs`. Cada execucao captura as contagens
de 27 tabelas, usa prefixos sinteticos exclusivos, remove somente entidades pertencentes
ao run atual em uma transacao local e compara o estado posterior com o baseline. O
cleanup fica em `finally`, portanto tambem ocorre sob excecao. O modo
`--inject-fixture-failure` prova retorno nao zero, preservacao de
`INJECTED_FIXTURE_FAILURE` e `FIXTURE_CLEANUP_PASS` nos quatro validadores. Nenhuma
limpeza historica ampla e nenhum reset por validador foram adicionados.

Durante a validacao foram corrigidos dois defeitos nas novas identidades de fixture:
codigo de store acima do limite de 50 caracteres e colisao de fingerprint entre ciclos
1/10 causada por `padEnd`. Os tags agora sao curtos e o fingerprint usa SHA-256.

### Prova de banco limpo e repetibilidade

- hashes P3-A/P3-B: inalterados e iguais ao baseline aprovado;
- migrations: 25;
- PostgreSQL: `127.0.0.1:15422`;
- resets nesta fase: exatamente 1;
- rebuild: 25/25 migrations aplicadas;
- T0: pgTAP 13 arquivos, 452/452, PASS;
- S0: 27 tabelas capturadas, somente `price_lists=1` do seed e demais contagens zero;
- ciclo 1: quatro validadores PASS e quatro `FIXTURE_CLEANUP_PASS`;
- S1 = S0: YES;
- T1: 452/452, PASS;
- ciclo 2 sem reset: quatro validadores PASS e quatro `FIXTURE_CLEANUP_PASS`;
- S2 = S1 = S0: YES;
- T2: 452/452, PASS;
- failure injection: quatro retornos nao zero, erro original preservado e estado final igual a S0;
- inventory: 100 ciclos nos dois ciclos completos, zero overselling;
- native checkout: 40 ciclos, 440 execucoes de cenarios, zero falhas/overselling;
- native order: 40 ciclos, 720 execucoes de cenarios, zero duplicidades/lost updates/falhas.

### Regressao

- testes P3-A/P3-B/P3-C0-TAX, cart, checkout e order com loader server-only: PASS;
- tax crypto runtime: PASS, incluindo envelope temporario para bundle duravel, tamper e AAD;
- `npm test`: 658/659; somente o teste Instagram previamente conhecido e fora do escopo falhou;
- typecheck: PASS;
- lint: PASS, zero erros e cinco warnings preexistentes;
- build: PASS; fallbacks de rede do Woo foram exercitados sem falhar o build;
- staging/production: nao acessados, zero writes;
- commit/push: nao executados.

Resultado: `LOCAL_VALIDATION_FIXTURE_ISOLATION_FAILURE` resolvido e
`SAFE_TO_RESTART_P3C_FROM_HASH_GATE = YES`. Isso nao aprova nenhum gate integrado P3-C.

## P3-C-R1 checkout readiness remediation

O blocker `P3C_CHECKOUT_PII_SEQUENCE_UNREACHABLE` foi corrigido localmente pela migration 26. `prepare_native_checkout` agora retorna `validating`; PII pode ser persistida nessa janela e a nova primitive server-only valida os prerequisitos antes de promover para `ready`. A evidencia historica da falha acima permanece preservada. Resultados completos: `docs/database/43-native-commerce-b3c3-p3c-checkout-readiness-remediation.md`.

## FINAL INTEGRATED RESTART AFTER FIXTURE ISOLATION

Data: 2026-09-05. Resultado: hard stop por blocker estrutural no primeiro teste de
composicao checkout/PII. Nenhum gate integrado anterior foi herdado.

### Gates frescos aprovados

- P3-A SHA-256: `a4ae5198f74af785154ba6275d3631be1950616c7a2a34425f168a240e8ab32d`;
- P3-B SHA-256: `12aabf11350cf0b3b58d886994b4daa127aac59e8f694fb42f5c41a3433d3459`;
- migration files/history: 25/25, de `20260823110000` a `20260904050000`;
- pre-harness state: igual ao baseline aprovado (`price_lists=1`, demais tabelas monitoradas sem residuos);
- pre-harness pgTAP: 13 arquivos, 452/452, PASS.

### Blocker estrutural confirmado

O diagnostico local transacional em `native-c3-integrated-validation.mjs` criou um
grafo sintetico minimo e invocou a unica primitive operacional aprovada para criacao de
checkout, `prepare_native_checkout`. A funcao cria a sessao em `validating`, monta os
snapshots/reservas e a promove para `ready` antes de retornar.

Em seguida, o harness tentou exercer a primitive P3-A `persist_checkout_pii` com owner
guest valido, versao retornada, envelope AES-256-GCM valido e TTL valido. O PostgreSQL
rejeitou deterministicamente a escrita com `CHECKOUT_STATE_INVALID`, pois P3-A permite
persistencia apenas em `open` ou `validating`. O trigger de lifecycle tambem proibe
introduzir PII quando o checkout ja esta `ready`.

Evidencia observada:

```text
checkoutCreationPrimitive = prepare_native_checkout
preparedStatus = ready
piiPersistenceError = CHECKOUT_STATE_INVALID
compositionPossible = false
```

Toda a fixture foi criada dentro de uma transacao encerrada por rollback controlado;
nenhum residuo foi persistido. O blocker afeta a composicao obrigatoria `checkout ->
secure temporary PII -> ready/submitting`: nao existe hoje uma primitive concedida ao
runtime que exponha a sessao ainda mutavel para a escrita P3-A, nem uma operacao atomica
que receba o envelope PII antes da promocao para `ready`.

Classificacao: `P3C_CHECKOUT_PII_SEQUENCE_UNREACHABLE`. A correcao minima recomendada
deve ser desenhada e versionada separadamente: ajustar a fronteira de preparacao para
manter o checkout em `validating` ate a persistencia/validacao de PII, ou criar uma
primitive server-only atomica que componha preparacao e PII antes de `ready`. Nao se
recomenda liberar mutacao generica de PII em `ready`.

Conforme o hard stop, migration 26 nao foi criada. Ownership completo, tax integrado,
pricing/shipping/inventory/order, races, rollbacks, deadlocks, post-harness pgTAP,
regressao final e staging read-only nao foram executados nem aprovados nesta tentativa.
Nao houve acesso remoto, provider calls, runtime activation, commit ou push.

Não houve chamadas Woo, Olist, pagamentos, frete ou OpenAI. Não houve commit ou push.

## Status após R1B-R2

Em 2026-09-05, baseline 27/27, pgTAP 488/488, matriz de preço e todas as
baterias concorrentes existentes passaram localmente/offline. O full P3-C não
foi retomado: a auditoria encontrou cobertura runtime incompleta no harness R1B,
registrada em `43-native-commerce-b3c3-p3c-checkout-readiness-remediation.md`.
Não houve reset, migration 28, acesso remoto ou ativação do runtime.

## Status após R1B-R3

A retomada R1B-R3 encontrou o blocker estrutural
`R1B_LOGISTICS_FINGERPRINT_AUTHORITY_MISSING`: um fingerprint logístico
sintaticamente válido, mas divergente, foi aceito por readiness. A fixture foi
revertida. A expansão da matriz e o full P3-C permanecem em hard stop; nenhuma
migration corretiva foi criada automaticamente.
