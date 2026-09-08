# B.3-C3-P3-C-M29-P0 — atomic native checkout submission design

## Atualização A2/B2 (2026-09-05)

O desenho foi materializado somente como candidata local em
`20260905180000_native_checkout_atomic_submission.sql`. O arquivo combina o hardening
do carrinho com `submit_native_checkout`, ainda não é canônico e não foi aplicado.

Data: 2026-09-05. Escopo exclusivamente local, offline e read-only. Nenhuma
migration, função, coluna, fixture ou role foi criada nesta fase.

## Resultado

O blocker `P3C_SUBMISSION_TOCTOU_GUARD_MISSING` foi reconfirmado no catálogo real.
O desenho recomendado é uma função estreita `SECURITY DEFINER`, acompanhada por um
helper canônico de hash e uma coluna imutável no pedido. A classificação do delta é
**C: função de submissão + helper interno/read-only + uma coluna/constraint**.

É seguro implementar a migration 29 localmente em uma fase separada. Este documento
não autoriza sua criação.

## Baseline e evidência do catálogo

- PostgreSQL `17.6`;
- 28 arquivos e 28 registros de migration;
- última migration `20260905130000_checkout_shipping_authority`;
- pgTAP canônico imediatamente anterior: 508/508 PASS;
- nenhuma função `submit_native_checkout` ou equivalente no schema `public`;
- `persi_app` não possui DML no agregado de pedido nem UPDATE em
  `checkout_sessions`;
- `orders.checkout_session_id` já é UNIQUE;
- checkout possui identidade idempotente UNIQUE por `(store_id,idempotency_key)`;
- o hash persistido em `checkout_sessions.request_hash` é
  `native-checkout-intent-v1`, enquanto o hash final existente no código é
  `c3-request-v1`; o hash final ainda não possui armazenamento durável.

Hashes protegidos permaneceram canônicos:

- P3-A: `a4ae5198f74af785154ba6275d3631be1950616c7a2a34425f168a240e8ab32d`;
- P3-B: `12aabf11350cf0b3b58d886994b4daa127aac59e8f694fb42f5c41a3433d3459`;
- migration 26: `8027bdad8973bcb3af92ac956f59dd0f81cae236a21fbe655282adea73c449df`;
- migration 27: `57eae6e2cead7a3e272c6fb69abddc9d0c58118ef8ad8ef287942d25a9a2cad0`;
- migration 28: `7d938dc2578aef9fac8c82058ea2a3dd7280546a9de0e9e52f6cd9cd3a39d45c`.

## Primitivas existentes

| Primitiva | Segurança / owner | Lock ou escrita relevante | Execução |
|---|---|---|---|
| `prepare_native_checkout(...)` | definer / `postgres`, volatile, search path vazio | cart, snapshots, preço, reserva | `persi_app` |
| `mark_native_checkout_ready(...)` | definer / `postgres`, volatile | checkout e cart; revalida preço, reserva e frete | `persi_app` |
| `resolve_store_price_authority(...)` | definer / `postgres`, volatile | advisory xact lock por store/moeda/contexto | app/worker |
| `resolve_checkout_authoritative_price(...)` | definer / `postgres`, volatile | `FOR KEY SHARE` em `prices` | somente interno |
| `canonical_checkout_price_fingerprint(...)` | invoker, immutable | nenhuma escrita | somente interno |
| `create_native_shipping_evidence(...)` | definer / `postgres`, volatile | checkout `FOR UPDATE`, evidência imutável | app |
| `replace_native_checkout_shipping_quote(...)` | definer / `postgres`, volatile | checkout `FOR UPDATE`, troca apenas em validating | app |
| `r1d_shipping_quote_is_authoritative(...)` | definer / `postgres`, stable | valida quote/evidence/fingerprint | somente interno |
| `canonical_checkout_logistics_fingerprint(...)` | invoker, stable | nenhuma escrita | somente interno |
| `reserve_inventory(...)` | invoker, volatile | nível e reserva; cria movement reservation | atualmente amplo |
| `release_inventory_reservation(...)` | invoker, volatile | reserva `FOR UPDATE`, depois nível | atualmente amplo |
| `confirm_inventory_reservation(...)` | invoker, volatile | reserva `FOR UPDATE`, depois nível; cria sale | atualmente amplo |
| `allocate_native_order_number(uuid)` | definer / `postgres`, volatile | UPDATE/row lock de store | app |
| `link_inventory_reservation_to_order_item(...)` | definer / `postgres`, volatile | reserva `FOR UPDATE`, sem movimento | app |
| `transition_native_order(...)` | definer / `postgres`, volatile | order `FOR UPDATE` + evento | app/worker |
| `validate_native_order_totals(uuid)` | invoker, volatile | valida ledger | app |
| `read_checkout_pii_envelope(...)` | definer / `postgres`, volatile | owner check, leitura do envelope | app |
| `clear_checkout_pii(...)` | definer / `postgres`, volatile | checkout `FOR UPDATE`, cleanup | app |

O acesso público hoje existente às funções legadas de inventory deve ser registrado
como dívida independente. A migration 29 não deve chamar confirmação, release ou nova
reserva e não deve ampliar esse acesso.

## Contratos das tabelas

Todas as 15 tabelas auditadas possuem RLS. Browser roles não têm DML. Orders, items,
addresses, adjustments e events são somente leitura para app/worker e possuem
triggers de imutabilidade. `orders.checkout_session_id`, número e sequência têm
unicidade. O evento inicial possui unique parcial e dois constraint triggers
`DEFERRABLE INITIALLY DEFERRED`. O vínculo de reserva é protegido por FK, unique
parcial e trigger que valida checkout, order, item, variante, quantidade, estado e
expiração.

Checkout possui triggers de transição, identidade, autoridade de preço, lifecycle de
PII e imutabilidade de snapshots. Quote não pode ser alterada quando o checkout está
`ready`; evidência é sempre imutável. Carrinho possui versão, owner exclusivo e estados
`active/locked/converted`. Inventory impede reserved maior que on-hand e preserva
ledger não nulo.

## Modelo de segurança

`submit_native_checkout` deve ser `SECURITY DEFINER`, de propriedade de `postgres`,
seguindo as funções atuais. Um owner dedicado sem login exigiria DML e políticas RLS
adicionais ou BYPASSRLS, aumentando o delta sem benefício nesta etapa. A função deve:

- usar `SET search_path=''`;
- qualificar todas as relações e funções sensíveis;
- não usar SQL dinâmico nem identifiers fornecidos pelo chamador;
- revogar execução de `PUBLIC`, `anon`, `authenticated`, `persi_worker` e
  `persi_readonly`;
- conceder EXECUTE somente a `persi_app`;
- manter revogado todo DML direto no agregado, checkout e reservas.

`persi_app` é uma role técnica server-only, nunca uma role de navegador. O endpoint
server valida sessão/autenticação, calcula o fingerprint da guest capability ou obtém
a identidade autenticada e a função repete o owner check. Posse do UUID nunca basta.

## Contrato proposto

Nome: `public.submit_native_checkout`.

Entradas mínimas, todas produzidas pela camada server confiável salvo os identificadores
originais do pedido HTTP:

- checkout ID, expected ready version, checkout idempotency key e
  `c3-request-v1` hash;
- customer ID **ou** guest capability fingerprint, nunca ambos;
- expected PII fingerprint e destination fingerprint;
- UUID do pedido e correlation UUID gerados pelo servidor antes da criptografia;
- contato canônico, billing e shipping canônicos originados do envelope autenticado;
- bundle fiscal durável opcional: tipo, ciphertext, fingerprint e máscara.

Não entram: preço, totals, shipping amount, inventory level/reservation IDs, order
number/status, SKU/nome de produto ou identificadores externos.

O retorno deve conter apenas `order_id`, `order_number`, `order_status`,
`checkout_status` e `checkout_version`.

## Divisão PII e criptografia fiscal

PostgreSQL não possui chaves. O servidor deve:

1. autenticar guest/customer e ler o envelope pela função protegida;
2. descriptografar e validar AES-GCM/AAD/fingerprints;
3. gerar antecipadamente o UUID canônico do pedido;
4. criar novo bundle fiscal com IV aleatório, purpose
   `persi.order.tax-document`, AAD de store/order/type/version/key ID e HMAC
   store-scoped;
5. enviar somente snapshots canônicos e bundle cifrado à função.

A função bloqueia o checkout e compara expected version, PII fingerprint, destination
fingerprint, owner e hash. Isso impede usar PII descriptografada de uma versão antiga.
O servidor é a fronteira confiável para a correspondência entre plaintext canônico e
fingerprints HMAC; browser nunca chama a função diretamente.

O cleanup da PII pode ocorrer dentro da mesma função após o agregado e as transições,
pois limpar colunas não exige chaves. Em rollback, o cleanup também reverte e a PII
permanece retryable. A função deve limpar somente depois de criar todos os snapshots.

## Idempotência e hash final

Armazenamento existente suficiente para identidade: checkout UNIQUE por store/key e
order UNIQUE por checkout. Falta somente persistir o hash final. Migration 29 deve
adicionar `orders.submission_request_hash text NOT NULL` com formato SHA-256; como o
runtime nativo ainda está desativado e não há orders atuais, não é necessário backfill.

Um helper canônico deve construir `c3-request-v1` exclusivamente a partir do estado
autoritativo: store, checkout/cart e versões esperadas, assignment/version/list,
fingerprints ordenados dos itens, PII/destination, selected quote identity,
logistics fingerprint/version e currency. O helper pode ser consultado por
`persi_app`, mas a função de submissão sempre o recalcula sob locks.

- same key/same hash: localizar order por checkout e retornar o mesmo agregado;
- same key/different hash: `CHECKOUT_IDEMPOTENCY_CONFLICT`;
- concorrência: lock do checkout serializa; UNIQUE(checkout) é defesa final;
- nenhum raw PII, ciphertext, IV, tag ou guest capability integra o hash.

O helper e `lib/db/nativeOrder.ts` deverão compartilhar o mesmo vetor canônico de
teste; não se deve confundir `native-checkout-intent-v1` com `c3-request-v1`.

## Lock order canônico

1. checkout session `FOR UPDATE`;
2. cart `FOR UPDATE`;
3. advisory lock de store/price context e assignment atual;
4. price list `FOR KEY SHARE`;
5. prices em ordem de `product_variant_id, price_id`, `FOR KEY SHARE`;
6. selected shipping quote e evidence, em ordem por ID, `FOR KEY SHARE`;
7. reservations em ordem de checkout line/ID, `FOR UPDATE`;
8. inventory levels na mesma ordem determinística, `FOR KEY SHARE`;
9. store sequence row através de `allocate_native_order_number`;
10. inserts do agregado, links, evento e transições finais.

Reservas precedem níveis porque `release_inventory_reservation` e
`confirm_inventory_reservation` já bloqueiam nessa ordem. Usar nível→reserva criaria
inversão e risco de deadlock. Replacement de shipping começa pelo checkout e fica
serializado. A autoridade de preço usa advisory lock compatível com seu trigger.

## TOCTOU e sequência da transação

Use um único `statement_timestamp()` capturado no início. Depois dos locks:

1. exigir checkout `ready`, não expirado, version/owner/store/cart corretos;
2. localizar eventual order idempotente; retornar apenas se o hash for igual;
3. validar cart `locked`, store/currency/version e conteúdo congelado;
4. resolver assignment atual e comparar ID/version/list/currency;
5. resolver cada preço atual e comparar validity, sale state, amounts e fingerprint;
6. validar quote/evidence completa e não expirada, ou contrato no-shipping;
7. validar cada reserva ativa, não expirada, unlinked, variante/nível/quantidade;
8. recomputar e comparar o hash `c3-request-v1`;
9. alterar checkout `ready → submitting`;
10. alocar número e inserir order `pending` com hash final;
11. copiar items, endereços e adjustments imutáveis e recalcular totals BIGINT;
12. vincular cada reserva existente ao order item, sem movimento;
13. inserir exatamente um evento `NULL → pending`, system;
14. validar totals e forçar constraints diferidas;
15. alterar checkout `submitting → order_created` e cart `locked → converted`;
16. limpar PII temporária;
17. retornar o identificador seguro; o commit é controlado pela chamada SQL.

Price rows ficam protegidos contra update/delete pelo key-share. Assignment fica
protegido pelo advisory lock e price list recebe lock explícito. Quote/evidence são
protegidos pelo lock e pela imutabilidade estrutural. Reserva/release/confirm ficam
serializados pelo lock da reserva. Não existe janela entre validação e commit.

Readiness continua sendo preflight; nunca é tratada como verdade permanente.

## Pedido, totals e inventory

- UUID: gerado pelo servidor antes do bundle fiscal e validado como ainda não usado;
- número: `allocate_native_order_number`; rollback reverte também a sequência;
- status: sempre `pending`;
- items: copiados dos snapshots de checkout, incluindo SKU/nome/valores/fingerprint;
- addresses: billing e shipping canônicos vindos do envelope autenticado;
- adjustments: somente registros derivados de regras já materializadas; como checkout
  ainda não possui ledger de ajustes, a primeira implementação deve inserir zero;
- totals: soma de linhas + shipping autoritativo; discount/tax/fee somente de ledger,
  todos em BIGINT minor units; `validate_native_order_totals` e constraints validam;
- evento: exatamente um `NULL → pending`, system;
- reserva: mesma reserva, apenas recebe `order_item_id`;
- on-hand e quantity_reserved: inalterados;
- novos movements reservation/sale: zero.

Pagamento, confirmação de estoque, fulfillment e integrações externas permanecem fora
da função. A ausência de outbox B3-G não bloqueia o commit local do pedido.

## Erros determinísticos

O contrato deve mapear sem SQL cru: `CHECKOUT_NOT_READY`, `CHECKOUT_EXPIRED`,
`CHECKOUT_VERSION_CONFLICT`, `CHECKOUT_OWNERSHIP_INVALID`, `CHECKOUT_PRICE_STALE`,
`CHECKOUT_SHIPPING_QUOTE_INVALID`, `CHECKOUT_RESERVATION_INVALID`,
`CHECKOUT_RESERVATION_EXPIRED`, `CHECKOUT_IDEMPOTENCY_CONFLICT`,
`CHECKOUT_PII_STALE`, `ORDER_TOTAL_INVALID` e `ORDER_INITIAL_EVENT_INVALID`.
Erros internos inesperados tornam-se `CHECKOUT_SUBMISSION_FAILED` na camada server.

## Defesa de escrita direta

Os testes da migration devem provar, com `SET ROLE`:

- INSERT direto em order por `persi_app`: denied;
- UPDATE direto de checkout para `order_created`: denied;
- UPDATE/relink direto de reservation: denied;
- execução da função aprovada: allowed;
- browser/public/worker: execute denied.

## Rollback e concorrência

Failpoints não entram na função de produção. Testes locais devem instalar triggers
temporários e transacionais que levantem erro após: submitting, number allocation,
order insert, primeiro item, addresses, adjustment, reservation link, antes/depois do
evento e antes das transições finais.

Todo rollback deve deixar: zero order/event/link residual, checkout ready, cart locked,
reserva preexistente active/unlinked, ledger reservation intacto, sale movement zero e
PII temporária retryable.

Matrizes futuras, cada uma com pelo menos 50 ciclos: double submit; same key/different
hash; price update/submission; nearest valid shipping race; reservation
release/expiry/submission; e numbering entre checkouts. Exigir zero stale/invalid
orders, duplicidades, overselling, deadlocks, timeouts e lost updates.

## Delta previsto

- classificação: C;
- nova função: `public.submit_native_checkout(...)`;
- helper: hash/contexto canônico de submissão, sem escrita;
- coluna: `orders.submission_request_hash text NOT NULL`;
- constraint: formato `^[0-9a-f]{64}$`;
- indexes: nenhum adicional necessário; checkout e order já são UNIQUE;
- tabelas: nenhuma nova;
- policies: nenhuma policy pública; nenhum DML amplo;
- grants: EXECUTE somente `persi_app`.

## Delta de aplicação previsto

- `lib/db/nativeOrder.ts`: alinhar construção de hash e adicionar chamada estreita;
- novo módulo server-only de orchestration de PII/tax/snapshots;
- route futura, ainda desativada, para autenticação e safe error mapping;
- testes unitários do payload, hash, error map e ausência de segredos.

## Fases futuras

- M29-A: revisão estática deste contrato e assinatura final;
- M29-B: criar migration e testes SQL locais, sem rebuild;
- M29-C: pre-apply transacional completo seguido de ROLLBACK;
- M29-D: um rebuild local explicitamente autorizado;
- M29-E: runtime/harness de submissão focado e matrizes concorrentes;
- M29-F: restart integral do P3-C.

Nome proposto, não criado:
`20260905180000_native_checkout_atomic_submission.sql`.

## M29-A/B reconciliation blocker

Na reconciliação obrigatória anterior à implementação, o catálogo real invalidou uma
premissa do P0: `locked` e `converted` não constituem hoje uma fronteira estrutural de
imutabilidade do carrinho. `persi_app` e `persi_worker` possuem policies `FOR ALL` e
DML direto em `carts` e `cart_items`. Os únicos triggers dessas tabelas mantêm
`updated_at`; não existe trigger de transição do status do carrinho nem guard que
impeça mutar itens quando o carrinho está `locked` ou `converted`.

Consequências:

- uma escrita direta concorrente em `cart_items` pode criar um phantom depois da
  comparação da submissão;
- o row lock em `carts` não bloqueia com segurança INSERT em `cart_items`;
- depois do commit, uma atualização direta pode reativar um carrinho `converted`;
- a afirmação P0 de proteção terminal do carrinho não é demonstrável com o schema
  atual.

Classificação: `M29_IMPLEMENTATION_CONTRACT_MISMATCH`. A migration candidata não foi
criada. Antes da implementação é necessário revisar o desenho para decidir, de forma
explícita, entre revogar DML direto e converter as primitivas de cart em funções
estreitas endurecidas, ou adicionar guards estruturais equivalentes que eliminem
phantoms e transições ilegais. Essa ampliação não foi autorizada implicitamente como
parte da M29-A/B.

### P0B prerequisite concluído

O redesenho read-only P0B aprovou defesa em profundidade: revogar DML direto de app e
worker, substituir policies ALL por SELECT, endurecer as funções de cart como
`SECURITY DEFINER` owner-checked e adicionar guards estruturais de status/version e
mutabilidade dos itens com parent cart lock. O hardening deve preceder a submissão na
mesma migration 29. Migration 30 não é necessária. Detalhes em
`docs/database/50-native-commerce-b3c3-cart-authority-hardening-design.md`.
