# B.3-C3-P3-C-R1 - Checkout readiness remediation

Data: 2026-09-05. Escopo local/offline; migration 26 nao implantada remotamente.

## Causa e lifecycle

`prepare_native_checkout` promovia diretamente `validating -> ready`, tornando a janela P3-A inacessivel: `persist_checkout_pii` aceita somente `open/validating`. A migration `20260905010000_checkout_readiness_sequence.sql` passa a manter o checkout em `validating`. O fluxo aprovado fica `open -> validating -> ready -> submitting -> order_created`, com `expired/cancelled` terminais.

`validating` significa cart locked, snapshots autoritativos criados e reservas ativas, mas ainda sem autorizacao para submissao. `ready` exige PII estrutural completa e vigente, owner/version coerentes, cart locked, price authority/list/currency coerentes, itens nao vazios, reservas ativas e vinculadas e, quando necessario, quote selecionada vigente ligada ao destination fingerprint e logistics metadata.

## Primitives e seguranca

- `prepare_native_checkout`: termina em `validating` e preserva idempotencia/reservas;
- `replace_native_checkout_shipping_quote`: restabelece quote depois que mudanca de destino invalida a anterior;
- `mark_native_checkout_ready`: owner-checked, optimistic e atomico;
- EXECUTE: somente `persi_app`; public/anon/authenticated/worker/readonly negados;
- PII generica em `ready` continua rejeitada por `CHECKOUT_STATE_INVALID`;
- readiness nao confirma reserva, nao cria sale movement e nao altera on_hand/reserved.

O trust boundary permanece server-only. Guest exige fingerprint da capability; customer exige identidade exata. UUID isolado nao autoriza as primitives.

## Validacao

- baseline: 25/25 migrations e pgTAP 452/452;
- rebuild unico: 26/26 migrations, PASS;
- pgTAP novo: 470/470 (18 assertions adicionadas);
- rerun pgTAP sem reset apos fixtures: 470/470;
- blocker original: prepare `validating`, PII persistida, readiness `ready`, PASS;
- mutacao PII em ready: rejeitada;
- PII/readiness race: 50 ciclos, 18 readiness wins/32 PII wins no run final, zero stale ready, duplicidade, deadlock ou overselling;
- checkout concurrency: 20 ciclos/220 execucoes, zero falhas/overselling;
- inventory: 50 ciclos, zero overselling;
- order: 20 ciclos/360 execucoes, zero falhas;
- testes server-only P3-A/P3-B/TAX/cart/checkout/order: 54/54;
- typecheck/build: PASS; lint: zero erros; npm test: somente baseline Instagram conhecido;
- fixture state final: igual ao baseline (`price_lists=1`, demais tabelas monitoradas zero).

P3-A e P3-B permaneceram imutaveis. Runtime nativo continua desativado. O full P3-C nao foi retomado.

## R1B RUNTIME MATRIX COMPLETION - HARD STOP

Data: 2026-09-05. O baseline fresco passou com 26/26 migrations, hashes imutaveis,
estado S0 limpo e pgTAP 470/470. O primeiro caso runtime critico da matriz de preco
identificou um defeito real na migration 26.

Uma fixture sintetica criou checkout em `validating`, persistiu PII valida e manteve
reservas/authority coerentes. O snapshot foi produzido quando `list_amount_minor=1000`.
Depois, a linha autoritativa de `prices` foi legitimamente atualizada para 1200. A chamada
real `mark_native_checkout_ready` retornou `ready`, mantendo o fingerprint do snapshot
antigo. Evidencia:

```text
preparedStatus = validating
currentPrice = 1200
readyStatus = ready
readyError = null
staleSnapshotAccepted = true
```

Caso: `PRICE_SNAPSHOT_FINGERPRINT_STALENESS`. Invariante esperado: readiness deve
recalcular ou comparar deterministicamente o fingerprint do preco autoritativo no mesmo
boundary e rejeitar snapshot obsoleto. Impacto: um checkout pode ser declarado pronto
com valor historico diferente do preco atualmente autoritativo, contrariando o contrato
R1. O teste inteiro foi revertido transacionalmente e S0 permaneceu limpo.

Conforme o hard stop R1B, a migration 26 nao foi alterada, migration 27 nao foi criada e
as matrizes restantes nao foram executadas/aprovadas. Uma remediation versionada parece
necessaria para revalidar `price_fingerprint` (incluindo periodo/promocao/currency) ou
definir explicitamente outra boundary imutavel de autoridade antes de readiness.

## Referencia R1C

O blocker acima foi corrigido localmente de forma versionada pela migration 27. A
evidencia, contrato canônico, locks e resultados estão em
`docs/database/44-native-commerce-b3c3-p3c-price-readiness-remediation.md`. Nenhum
deploy remoto foi realizado e a R1B ainda não foi reiniciada.

## R1B-R2 FULL RUNTIME MATRIX - COVERAGE HARD STOP

Data: 2026-09-05. A retomada local/offline confirmou Docker 29.7.2,
PostgreSQL 17.6 em `127.0.0.1:15422`, 27/27 migrations, os quatro hashes
aprovados e pgTAP 488/488. O snapshot persistente inicial não continha fixtures
de execução. Não houve reset, truncate ou acesso remoto.

A matriz comercial existente passou para preço inalterado, aumento, redução,
início/fim de promoção, fim de validade, assignment stale e duas linhas com um
único `statement_timestamp()`. As baterias concorrentes também passaram: preço
50 ciclos, PII/readiness 50 ciclos, readiness 50 ciclos, inventory 50 ciclos,
checkout 20 ciclos/220 execuções e order 20 ciclos/360 execuções; zero
overselling, deadlock, duplicata ou lost update.

Durante a auditoria de cobertura foi constatado que
`scripts/database/checkout-readiness-runtime-matrix.mjs` possui somente a matriz
de preço. Os casos runtime obrigatórios de guest/customer ownership, customer
version, PII ausente/expirada, shipping ausente/expirado/mismatch/replacement,
reservation mismatch, transições ilegais e rollback injetado não são executados
por esse harness. Existem asserções pgTAP e testes unitários relacionados, mas o
protocolo R1B-R2 proíbe herdar esses gates sem a execução runtime fresca.

Blocker: `R1B_R2_RUNTIME_MATRIX_COVERAGE_INCOMPLETE`. Não é defeito de schema e
não requer migration 28. A correção seguinte deve ampliar o harness existente,
com fixtures sintéticas transacionais e cleanup determinístico, antes de repetir
e aprovar a R1B-R2. O full P3-C permanece bloqueado.

O rerun também revelou que `checkout-pii-concurrency.mjs` não removia suas 20
fixtures. A falha foi corrigida no próprio harness com ownership por `runId`,
`try/finally`, remoção restrita dos shipping methods sintéticos e comparação do
snapshot. As 20 fixtures desta execução foram removidas por identidade exata; o
rerun exibiu `FIXTURE_CLEANUP_PASS`, o snapshot final voltou a ser igual ao S0 e
o pgTAP pós-limpeza retornou 488/488 PASS.

## R1B-R3 COMPLETE RUNTIME MATRIX - STRUCTURAL HARD STOP

Data: 2026-09-05. A expansão do harness começou pelo cenário obrigatório
`SHIPPING_LOGISTICS_FINGERPRINT`. A fixture runtime criou checkout sintético com
preço, PII, reserva e cotação coerentes, substituiu a cotação pela primitive
canônica e então alterou somente `logistics_fingerprint` para outro valor
hexadecimal válido de 64 caracteres. `mark_native_checkout_ready` retornou
`ready`; o esperado era `CHECKOUT_SHIPPING_QUOTE_INVALID`.

Evidência segura do registry: `executed=true`, `expected=CHECKOUT_SHIPPING_QUOTE_INVALID`,
`actual=ready`, `result=FAIL`, `fixtureCleanup=TRANSACTION_ROLLBACK`.

Causa: readiness valida apenas presença/formato de `logistics_fingerprint` e
`logistics_version`; não existe comparação com evidência logística autoritativa.
Blocker: `R1B_LOGISTICS_FINGERPRINT_AUTHORITY_MISSING`. Trata-se de invariante
estrutural. Conforme a política da R1B-R3, a matriz foi interrompida no primeiro
blocker, migration 28 não foi criada e o full P3-C permanece bloqueado.

## Referência R1D

A autoridade logística local foi desenhada na migration 28 e documentada em
`46-native-commerce-b3c3-shipping-authority-remediation.md`. O primeiro e único
rebuild autorizado falhou por uma FK sem unique constraint compatível. A fonte
foi corrigida, mas não houve segundo reset; R1D permanece em hard stop e não foi
implantada remotamente.

Na retomada R1D-R2, o estado pré-reset estava íntegro, mas a revisão estática
identificou `R1D_CANONICAL_FINGERPRINT_NULLABLE_INPUT_STRICT`. O reset adicional
não foi consumido e a validação da migration 28 continua bloqueada.

Na R1D-R2B, o único rebuild autorizado foi consumido e falhou na migration 28
com SQLSTATE `42601`, dentro da expressão de conflito idempotente. O rollback
foi completo e o histórico local permaneceu em 27; não houve retry ou acesso
remoto.

Na R1D-R2C, a correção do parser foi aceita pelo PostgreSQL em pre-apply
completa e transacional. Smokes de fingerprint, evidência, idempotência,
imutabilidade e segurança passaram; o rollback restaurou integralmente o estado.
Nenhum reset foi executado e a migration 28 segue não aplicada persistentemente.

## Referência final R1D-R2D

Em 2026-09-05, o rebuild local único aplicou a migration 28. Registry runtime
9/9, pgTAP 508/508,
matrizes concorrentes sem overselling/deadlock e regressão offline aprovada,
mantido apenas o baseline preexistente 666/667 do Instagram. Detalhes e hash
canônico estão em `46-native-commerce-b3c3-shipping-authority-remediation.md`.
O gate específico replacement/readiness foi encerrado na R1D-R2E com 50/50
ciclos, S0 igual a S1 e zero mixed-ready, deadlock, timeout, lost update ou
overselling. R1D está completa; R1B-R3 exige autorização separada antes de ser
reiniciada.

## R1B-R3-R2 — complete runtime matrix (2026-09-05)

A matriz R1B foi reiniciada após as correções de autoridade de preço e frete.
O registry explícito em `scripts/database/r1b-r3-r2-runtime-registry.mjs`
contém 98 cenários obrigatórios nas categorias guest, customer, PII, shipping,
price, reservation, state, rollback, client authority, public projection,
error contract, concurrency e offline isolation. Foram executados 98/98, sem
lacunas. O completeness guard retornou `R1B_RUNTIME_MATRIX_INCOMPLETE` para uma
entrada obrigatória sinteticamente omitida, e a execução normal passou.

Guest e customer foram validados em fixtures PostgreSQL independentes: owner
válido passou; capability ausente/incorreta/cross-checkout, customer incorreto e
ID override foram negados; versão stale retornou conflito; nenhuma capability
em texto puro foi persistida. A injeção de falha do novo harness confirmou
cleanup por rollback transacional.

A matriz de shipping executou novamente happy path, missing evidence,
fingerprint/version/amount/currency/provider/service/destination tamper,
expiração e replacement. A matriz de preço executou unchanged, increase,
decrease, sale start/end, validity, assignment e single-as-of multiline. Tax,
PII, reservas, estados, rollback, RLS/grants e projeções públicas passaram nos
harnesses e pgTAP correspondentes.

Concorrência reexecutada: price/readiness 50 ciclos; shipping/readiness 50;
PII/readiness 50; inventory 50; checkout 20 ciclos/220 execuções; order 20
ciclos/360 execuções. Resultado agregado: zero deadlocks, timeouts, lost
updates, stale/mixed-ready, duplicidades ou overselling; sale movements antes
de pagamento permaneceram zero.

pgTAP antes e após a matriz: 508/508. `db:test` passou integralmente. A
regressão offline terminou com 666/667 em `npm test`, mantendo somente o
baseline não relacionado do Instagram; typecheck, lint sem erros e build
offline passaram. O guard bloqueou tentativas de provider e confirmou zero
requisições externas reais. Nenhuma migration, schema ou runtime de produção
foi criado ou alterado. Os hashes P3-A, P3-B e migrations 26–28 permaneceram
canônicos. É seguro solicitar autorização separada para reiniciar o full P3-C.

## Final P3-C restart — submission composition hard stop

O restart final confirmou o baseline 28/28 e pgTAP 508/508, mas interrompeu no
preflight obrigatório. Não existe primitiva runtime que componha a submissão do
checkout e a criação do agregado de pedido em uma única transação; `persi_app` não
possui escrita direta no agregado nem update de `checkout_sessions`. Blocker:
`P3C_SUBMISSION_TOCTOU_GUARD_MISSING`. Nenhum gate integrado foi simulado como owner,
migration 29 não foi criada e não houve acesso remoto. Relatório completo em
`docs/database/47-native-commerce-b3c3-p3c-final-integrated-validation.md`.
