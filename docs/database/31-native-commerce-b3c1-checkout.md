# B.3-C1 — fundação local do checkout nativo

> Implementação local/dark. Woo cart, checkout e order continuam operacionais.
> Nenhuma migration foi aplicada ao staging.

## Escopo

A migration `20260902230000_native_checkout_foundation.sql` cria somente
`checkout_sessions`, `checkout_session_items`, `checkout_shipping_quotes` e o
enum `checkout_session_status`. Não cria order, payment, refund ou outbox.

A alteração mínima em tabelas existentes é:

- UNIQUE `(carts.id, carts.store_id)` para permitir FK composta e impedir
  checkout cross-store no banco;
- `inventory_reservations.checkout_session_item_id`, FK `RESTRICT`, índice de
  lookup e UNIQUE parcial item+level. O ledger e as funções de inventory
  existentes continuam sendo a única implementação de saldo/reserva.

## Estado e ownership

Estados: `open -> validating -> ready -> submitting -> order_created`;
`open|validating|ready -> expired|cancelled`; `submitting -> ready` apenas para
falha comprovadamente anterior ao futuro commit de order. Estados terminais não
reabrem. Trigger valida a matriz e incrementa version.

Store/currency/customer devem coincidir com o cart. Guest reutiliza a capability
do cart: o serviço transforma o token em SHA-256 e o banco compara somente o
fingerprint. UUID de checkout não é credencial. Token bruto não é persistido,
incluído no request hash nem logado.

UNIQUE `(store_id,idempotency_key)` e `request_hash` implementam retry: mesma
key/hash recupera a mesma sessão, inclusive após corrida no cart lock; hash
diferente falha. Um índice parcial permite apenas uma session não terminal por
cart.

## Request e fingerprints

`createNativeCheckoutRequestHash` serializa objeto versionado, chaves ordenadas,
bigints decimais e somente store, cart, customer, cart version, price list,
inventory location, currency e shipping requirement. Expiração, token e PII não
participam. O fingerprint logístico ordena linhas por variant e inclui cart
version, quantidades, destination postcode, origin/location, service e logistics
version; não inclui segredos.

## Price e item snapshot

`prepare_native_checkout` exige `price_list_id` explícito, ativo e na moeda do
cart. Preços precisam estar ativos e no período `[valid_from,valid_to)`. Sale é
usado apenas dentro de `sale_valid_from/sale_valid_to`. Não há heurística por
priority e nenhum preço vem do browser/Woo.

Cada linha guarda IDs, SKU/nome, quantity, regular/effective/subtotal/discount/
tax/total em `BIGINT` minor units, currency, price validity e fingerprints.
CHECKs validam multiplicação e fórmula. Depois de `ready`, triggers impedem
INSERT/UPDATE/DELETE de item ou quote.

`STORE_PRICE_LIST_MAPPING_STATUS = REQUIRED_BEFORE_C3`: C1 usa contexto explícito
nos testes. O mapping store-price-list deve ser versionado antes da integração.

## Shipping snapshot

Quote selecionada guarda provider/service/carrier, amount bigint, currency,
promise, postcode normalizado, destination/logistics fingerprints, version,
referência opaca e expiry. UNIQUE parcial assegura uma selecionada. O snapshot é
independente de `shipping_quote_cache`; nenhum provider é chamado.

## Reserva e transações

`prepare_native_checkout` é uma transação PostgreSQL: serializa pelo cart,
valida owner/version/store, trava o cart, resolve catálogo/preço, cria snapshots,
chama `reserve_inventory` para cada item, associa reservation ao snapshot, valida
quote e termina em ready. Falha em qualquer item desfaz session, snapshots,
movements, reservas e cart lock.

Chave estável de reserva:
`checkout:<session>:item:<item>:level:<location>`. C1 usa uma inventory location
explicitamente; alocação multi-location fica fora do escopo. Reservation expira
no máximo junto da session/quote e permanece `active`; C1 nunca chama confirm.

`close_native_checkout` serializa a session, libera reservations ativas pelas
funções existentes, marca cancelled/expired e reabre somente o cart ainda locked
na version esperada. É idempotente. Não há scheduler nesta fase.

## Segurança e acesso

As três tabelas têm RLS. `anon`, `authenticated`, `public` e `persi_readonly` não
possuem acesso. `persi_app`/`persi_worker` recebem somente SELECT nas tabelas;
mutação ocorre por funções controladas. Orquestração usa `SECURITY DEFINER` por
necessidade de atravessar RLS sem conceder escrita ampla em inventory, com
`search_path=''`, parâmetros estritos e EXECUTE revogado de browser/public.
Nenhuma PII de endereço/documento foi adicionada em C1.

O read model server-only agrega session, items, quote selecionada e resumo de
reservations em uma consulta set-based, sem N+1 e sem exposição pública.

## Índices e concorrência

Há índices para idempotência, active cart, customer/store, expiry, item traversal,
price, selected quote e reservation owner. EXPLAIN confirmou sua elegibilidade;
em tabelas pequenas o planner pode preferir seqscan naturalmente.

A suíte concorrente cobre 20 ciclos de cada cenário: double-click, active
checkout uniqueness, cart mutation race, last-unit inventory, multi-item rollback
e expiration race. Resultado esperado obrigatório: zero falhas e zero
overselling.

## Fronteiras seguintes

- C2 cria somente order ledger e snapshots imutáveis;
- C3 integra T-order e mapping store-price-list;
- B3-D trata payment e confirmação de inventory;
- runtime/cutover exigem autorização independente.
