# B.3-C3-P3-C-R1C - Price readiness remediation

Data: 2026-09-05. Banco e migrations exclusivamente locais; nenhum staging foi
acessado. Durante `next build`, o código preexistente carregou `.env.local` e tentou
leituras remotas da Store API (HTTP 500) e realizou leitura do Instagram Graph API.
Não houve escrita remota, mas o gate absoluto `PRODUCTION_ACCESSED = NO` não foi
atingido e exige isolamento de ambiente antes da retomada.

## Blocker e causa

O runtime R1B demonstrou que um checkout preparado com preço 1000 podia chegar a
`ready` depois que a mesma linha autoritativa passava a 1200. A migration 26 validava
lista/currency, mas não recompunha preço efetivo nem comparava o fingerprint atual.

A migration `20260905020000_checkout_readiness_price_revalidation.sql` corrige o
contrato sem price-lock e sem reprecificação silenciosa. `ready` significa coerência
com a autoridade comercial corrente; divergência retorna `CHECKOUT_PRICE_STALE` e
mantém checkout e snapshots intactos em `validating`.

## Contrato canônico

`canonical_checkout_price_fingerprint` é a definição única, compartilhada por prepare
e readiness através de `resolve_checkout_authoritative_price`. Entradas: price ID,
list amount, sale amount, `valid_from`, `valid_to`, `sale_valid_from`, `sale_valid_to`
e currency. Effective amount é resolvido no mesmo helper pela vigência da promoção.

Prepare captura um único `statement_timestamp()`, resolve a autoridade explícita
store/currency/`storefront_retail`, exige a lista fornecida e persiste assignment ID,
version e price-list ainda em `validating`. Readiness captura seu próprio único
`statement_timestamp()` confiável; cliente não fornece `as_of`. Ela exige o mesmo
assignment/version/list e compara ID, currency, list/effective amounts, validade e
fingerprint de cada linha.

O resolvedor usa `FOR KEY SHARE` na linha de preço. Ordem relevante: checkout session,
cart, advisory lock da autoridade, price rows e depois leitura das reservations. Assim,
readiness que trava o preço antigo primeiro pode concluir coerentemente; atualização
que vence primeiro faz readiness rejeitar. O helper não possui EXECUTE público, anon,
authenticated, app, worker ou readonly; é consumido internamente por funções security
definer server-only.

## Evidência runtime

- controle sem alteração: `ready`;
- 1000 -> 1200 e 1200 -> 1000: `CHECKOUT_PRICE_STALE`;
- início/fim de sale e fim de validade: rejeitados;
- assignment N -> N+1: rejeitado;
- currency inválida: rejeitada por constraint antes da readiness;
- lista não autoritativa: rejeitada no prepare;
- duas linhas: ambas validadas com o mesmo `v_as_of`, PASS;
- snapshots, PII, quote, reservations, inventory e orders não sofrem mutação no erro;
- corrida 50 ciclos: 9 old-coherent wins, 41 stale rejections, zero stale-ready,
  deadlocks, timeouts ou lost updates.

## Rebuild e regressão

Foi executado exatamente um reset local autorizado: 27/27 migrations aplicadas.
pgTAP: 488/488 antes e depois das fixtures (18 assertions R1C). `npm run db:test`
passou, incluindo PIM, pricing, price-history, inventory, external mappings, Drizzle e
BIGINT. Readiness 50 ciclos, inventory 50, checkout 20/220 e order 20/360 passaram sem
overselling ou duplicidade. Typecheck, lint (zero erros, cinco warnings conhecidos),
build e diff check passaram. `npm test`: 658/659; permanece somente o baseline conhecido
do Instagram (`InstagramCarousel` versus `InstagramCarouselLazy`), fora do escopo.

Migration 27 não foi implantada. Runtime nativo permanece desativado. R1B não foi
reiniciada. Apesar da correção técnica passar, `SAFE_TO_RESTART_R1B = NO` até o build
ser comprovadamente isolado de integrações remotas.

## Remediação operacional R1C-ISO

O isolamento foi implementado e validado posteriormente sem reescrever este histórico.
Consulte `docs/database/45-local-offline-build-validation.md`. O build offline passou
com zero requisições externas reais; o gate operacional passa a permitir uma futura
retomada explícita da R1B.
