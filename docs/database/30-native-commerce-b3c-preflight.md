# B.3-C0 — preflight do checkout e pedido nativos

> Status: **DESIGN ONLY**. Este documento não cria migration, schema Drizzle,
> rota, fixture ou runtime. WooCommerce continua sendo a autoridade operacional.

## 1. Evidência do runtime atual

O checkout público atual é Woo-first:

- `app/api/cart/route.ts`, `app/api/cart/items/route.ts` e
  `app/api/cart/coupons/route.ts` delegam ao Woo Store API e preservam o
  `Cart-Token` em cookie HTTP-only;
- `app/api/checkout/customer/route.ts` envia endereço ao carrinho Woo;
- `app/api/checkout/shipping/route.ts` seleciona a rate Woo;
- `components/Checkout/CheckoutForm.tsx` coordena profile, endereço e pagamento e
  cria uma UUID de idempotência estável para a tentativa;
- `app/api/checkout/payment/route.ts` relê o carrinho Woo, confere total,
  adquire a tentativa atômica, cria o pedido Woo e então chama Inter,
  Mercado Pago ou PagBank;
- `services/woocommerce/orders.ts` cria e reconcilia WC_Order. A chave de
  idempotência, referência do PSP e prova de posse ficam em metadata Woo;
- `lib/commerce/checkoutAttempt.ts` usa o endpoint WordPress
  `/wp-json/persi-headless/v1/checkout-attempt` para lease e máquina de estados;
- `app/checkout/confirmacao/page.tsx` e as rotas `payment/status` e
  `payment/boleto-pdf` recuperam/reconciliam a tentativa e autorizam por
  Cart-Token ou sessão da conta;
- `services/checkout/checkoutIdentity.ts` mantém login/password/OTP no WordPress;
- frete exibido no checkout vem dos packages/rates do Woo. A fundação nativa de
  shipping e seu cache ainda não são autoridade do checkout;
- estoque é validado implicitamente pelo Woo nesse fluxo. Nenhuma reserva nativa
  é criada.

Esse runtime não será alterado em B.3-C1/C2/C3. Cutover exige fase própria,
feature flag, canary e rollback.

## 2. Fundação de inventário reutilizada

Tabelas existentes: `inventory_levels`, `inventory_reservations` e
`inventory_movements`.

Primitivas SQL existentes, todas `SECURITY INVOKER`:

| Função | Argumentos | Semântica |
| --- | --- | --- |
| `reserve_inventory` | level UUID, quantity bigint, reference type/id, idempotency key, expiry, source | `UPDATE` condicional em `inventory_levels`; incrementa reserved, cria reservation e movement |
| `release_inventory_reservation` | reservation UUID, source reference/system | lock na reservation; decrementa reserved; `active -> released`; repetição terminal é no-op |
| `confirm_inventory_reservation` | reservation UUID, source reference/system | lock na reservation; decrementa on-hand e reserved; `active -> confirmed`; repetição terminal é no-op |

`reserve_inventory` impede `quantity_reserved > quantity_on_hand`. A chave global
`inventory_reservations.idempotency_key` rejeita a mesma chave com payload
diferente. Estados existentes: `active`, `released`, `confirmed`, `expired` e
`cancelled`. Não existe worker de expiração; B.3-C deverá implementar transição
atômica que libere o saldo, nunca apenas trocar o status.

Extensão mínima prevista, sem segundo sistema de reservas:

- C1 adiciona `checkout_session_item_id UUID NULL` com FK `RESTRICT` e UNIQUE
  `(checkout_session_item_id, inventory_level_id)` quando não nulo;
- C2 adiciona `order_id UUID NULL` com FK `RESTRICT` para associar as mesmas
  reservations ao pedido;
- `reference_type='checkout_session_item'`, `reference_id=<UUID>` e chave
  `checkout:<session>:item:<item>:level:<level>` permanecem como identidade
  textual auditável;
- a reservation continua pertencendo à checkout session depois de criar pedido;
  `order_id` é associação de transição, não nova reserva.

## 3. Modelo de checkout session (C1)

### `checkout_sessions`

| Campo | Tipo/regra |
| --- | --- |
| `id` | UUID PK aleatória |
| `store_id` | UUID NOT NULL, FK stores RESTRICT |
| `cart_id` | UUID NOT NULL, FK carts RESTRICT |
| `customer_id` | UUID NULL, FK customers RESTRICT |
| `status` | enum `checkout_session_status` |
| `currency` | CHAR(3), uppercase |
| `idempotency_key` | TEXT NOT NULL, valor opaco server-side |
| `request_hash` | CHAR(64), SHA-256 do payload canônico inicial |
| `cart_version` | BIGINT NOT NULL |
| `correlation_id` | UUID NOT NULL UNIQUE |
| `contact_payload_ciphertext` | TEXT NULL, envelope versionado cifrado |
| `billing_address_ciphertext` | TEXT NULL, envelope versionado cifrado |
| `shipping_address_ciphertext` | TEXT NULL, envelope versionado cifrado |
| `address_fingerprint` | CHAR(64) NULL; HMAC, não hash reversível simples |
| `selected_shipping_quote_id` | UUID NULL; FK adicionada após criar quotes |
| `expires_at` | TIMESTAMPTZ NOT NULL, maior que created_at |
| `version` | BIGINT NOT NULL DEFAULT 0 |
| `created_at`, `updated_at` | TIMESTAMPTZ |

Constraints:

- UNIQUE `(store_id, idempotency_key)`;
- UNIQUE parcial `(cart_id)` para estados não terminais, impedindo duas sessões
  concorrentes para o mesmo cart;
- customer deve coincidir com o owner do cart quando presente; para guest,
  ownership é verificado pelo serviço com store + capability, nunca pelo UUID;
- moeda e store não mudam durante a sessão;
- mesma key + mesmo hash retorna a sessão existente; mesma key + hash diferente
  retorna conflito determinístico e não reutiliza dados.

Estados aprovados, preservando B.2:

```text
open -> validating -> ready -> submitting -> order_created
open|validating|ready -> expired|cancelled
submitting -> ready            (somente falha comprovada anterior ao commit)
```

Não existe transição genérica para `failed`: falhas recuperáveis preservam estado
e código sanitizado fora do agregado; cancelamento é explícito. Estados terminais
não reabrem. Transições usam estado e version esperados sob row lock.

TTL é configuração server-only e curta. A sessão só fica `ready` se reservas,
itens, endereço e quote continuarem válidos. Session ou reservation expirada
exige release transacional e novo checkout; nunca ressuscitar reservation.

### `checkout_session_items`

Snapshot comercial temporário controlado:

- `id`, `checkout_session_id`, `line_number`;
- `product_id`, `product_variant_id` como FKs RESTRICT enquanto temporário;
- `sku_snapshot`, `product_name_snapshot`, `variant_label_snapshot` nullable;
- `quantity BIGINT > 0`;
- `unit_list_amount_minor`, `unit_sale_amount_minor`,
  `unit_effective_amount_minor`, `line_subtotal_minor` como BIGINT não negativos;
- `currency CHAR(3)`;
- `price_id`, `price_valid_from`, `price_valid_to`, `price_fingerprint`;
- `source_fingerprint` cobrindo variante, quantidade, price e cart_version;
- timestamps.

GTIN não é necessário para validar checkout e fica fora de C1. Ele pode ser
copiado diretamente ao order item em T-order se a exigência fiscal/operacional
for confirmada. Não copiar descrição, PIM ou JSON arbitrário.

UNIQUE `(checkout_session_id, line_number)` e
`(checkout_session_id, product_variant_id)`. Aritmética:

```text
unit_effective = sale_amount quando sale está dentro de sale_valid_from/to;
                 caso contrário list_amount
line_subtotal = unit_effective * quantity
```

Overflow é rejeitado. Depois de `validating -> ready`, itens não são atualizados;
qualquer mudança relevante cancela/expira a sessão e cria outra.

### Autoridade de preço

O preço vem somente de `prices` unido a `price_lists`, ambos ativos, mesma moeda,
período `[valid_from, valid_to)` vigente e sale window vigente. A lista é
selecionada deterministicamente por store/channel/segment e `priority`; enquanto
não houver mapping explícito store-price-list, C1 deve exigir configuração
server-side inequívoca e falhar fechado — nunca escolher uma entre várias por
acaso. O Woo não é autoridade do checkout nativo.

Preço corrente pode mudar; o checkout conserva o valor validado; o pedido copia
o valor novamente para snapshot histórico imutável. Antes de T-order, sessão,
price fingerprint e expiração são revalidados. Mudança exige novo consentimento.

## 4. Shipping quote snapshot (C1)

### `checkout_shipping_quotes`

- `id`, `checkout_session_id`, `shipping_method_id` nullable;
- `provider`, `external_service_code`, `carrier_name`, `service_name`;
- `amount_minor BIGINT >= 0`, `currency CHAR(3)`;
- `estimated_delivery_days` e `estimated_delivery_at` nullable;
- `destination_postcode` normalizado e `destination_fingerprint` HMAC;
- `logistics_fingerprint` e `logistics_version`;
- `provider_quote_reference` opaca e nullable;
- `quoted_at`, `expires_at`, `selected_at` nullable;
- UNIQUE `(checkout_session_id, quote_key)` e no máximo uma quote selecionada.

`shipping_quote_cache` é cache descartável e nunca histórico. A quote persistida
é snapshot independente. Revalidar se expirada ou se mudarem cart_version,
quantidade, destination, peso/dimensões, origem, método ou logistics_version.
Chamada a provider sempre ocorre fora de transação; uma transação curta persiste
somente o resultado validado. T-order rejeita quote expirada/divergente.

## 5. Cart -> checkout -> reservation

### T-checkout-create

Uma única transação PostgreSQL:

1. cria/reobtém a linha de idempotência e valida request_hash;
2. bloqueia cart e items; comprova store, owner, `active`, expiry e version;
3. muda cart para `locked`, incrementando version;
4. cria session `open -> validating`;
5. resolve variantes ativas e preços vigentes de forma set-based;
6. cria item snapshots;
7. resolve inventory levels em ordem determinística `(level_id)`;
8. chama `reserve_inventory` para todas as linhas;
9. se qualquer reserva falhar, toda a transação faz rollback, inclusive as
   reservas/movements anteriores;
10. mantém session `validating` até dados/quote válidos; depois transição curta
    para `ready`.

Nenhuma API externa participa dessa transação. Cart mutation exige `active`, de
modo que cart locked não pode correr silenciosamente com snapshot.

Cart volta a `active` somente em cancelamento/falha pré-order comprovada, depois
de liberar todas as reservations e se não houver order. Expiração marca session
expired, libera reservas e reativa cart apenas se ele ainda estiver ligado à
mesma session/version. Sucesso em T-order marca cart `converted`; ele nunca volta.

## 6. Modelo de pedido (C2)

### `orders`

- `id UUID` canônico;
- `store_id` obrigatório; `customer_id` nullable e `ON DELETE SET NULL` somente
  em workflow futuro de anonimização controlada;
- `checkout_session_id` obrigatório e UNIQUE por store;
- `order_sequence BIGINT > 0` e `order_number TEXT`;
- `status order_status`;
- `currency CHAR(3)`;
- `items_subtotal_minor`, `discount_total_minor`, `shipping_total_minor`,
  `tax_total_minor`, `fee_total_minor`, `grand_total_minor`: BIGINT >= 0;
- snapshots de `contact_name`, `contact_email`, `contact_phone` conforme mínimo
  operacional;
- tax ID opcional como bundle `type/ciphertext/fingerprint/masked`, nunca plaintext;
- `correlation_id`, `version`, `placed_at`, `created_at`, `updated_at`.

UNIQUE `(store_id, order_sequence)`, `(store_id, order_number)` e
`(store_id, checkout_session_id)`. IDs Woo/Olist/PSP não são PK nem colunas de
identidade canônica; pertencem a mappings/ledgers posteriores.

Numeração é alocada por incremento atômico de `stores.next_order_sequence`
adicionado em C2: `UPDATE ... SET next_order_sequence=next_order_sequence+1
RETURNING`. Não usar MAX/COUNT. O número inicial seguro é
`UPPER(store.code)-YYYY-NNNNNN`; formato poderá ser configurado antes do cutover,
sem alterar a unicidade numérica. Gaps são aceitáveis.

Estados mínimos:

```text
pending_payment -> paid | cancelled
paid -> processing | cancelled
processing -> ready_to_ship | cancelled
ready_to_ship -> shipped | cancelled
shipped -> delivered
```

Pagamento, refund, reservation e shipment possuem estados independentes.
`payment_failed` não é order status. B3-C somente cria `pending_payment`.

### `order_items`

Snapshot imutável: line number; product/variant IDs nullable com `ON DELETE SET
NULL`; SKU, GTIN nullable, product name, variant label; quantity; unit list,
unit effective, discount, tax, subtotal e line total em minor units; currency;
price/source fingerprints. UNIQUE order+line e, enquanto não houver linhas
duplicadas justificadas, order+variant. Trigger bloqueia UPDATE/DELETE.

### `order_addresses`

Uma linha `billing` e uma `shipping` quando entrega for aplicável. Campos
normalizados: recipient, company, address lines, number, neighborhood, city,
state, postcode, country. FK é apenas para order; não há FK para
`customer_addresses`. Mesmo endereço pode ser copiado duas vezes para preservar
o papel comercial. Trigger bloqueia UPDATE/DELETE.

### `order_adjustments`

Ledger imutável tipado, sem colunas por cupom/meio de pagamento:

- `order_id`, `order_item_id` nullable, `scope` (`order`/`item`);
- `type`: `coupon`, `promotion`, `manual_discount`, `payment_discount`,
  `shipping_discount`, `fee`;
- `effect`: `discount` ou `charge`;
- `amount_minor BIGINT > 0`, currency, code/reference, source, actor e reason;
- correção/reversão referencia a linha anterior e cria nova linha.

B3-C registra somente ajustes já calculados/validados. Woo coupon engine continua
ativo no runtime atual; um motor nativo de promoção não faz parte desta fase.

### `order_status_events`

Append-only: order, from/to status, actor_type, actor_id nullable, source,
reason_code, reason, correlation_id e occurred_at. Actor privilegiado deriva da
sessão/role server-side. UNIQUE de source+external_event_id quando existir.

### Totais

```text
item_subtotal = unit_effective * quantity
line_total = item_subtotal - line_discount + line_tax
items_subtotal = SUM(item_subtotal)
grand_total = items_subtotal - discount_total
              + shipping_total + tax_total + fee_total
```

Magnitude de desconto é positiva. CHECKs impedem valores negativos, desconto
maior que sua base e fórmula divergente. O servidor recalcula dentro de T-order;
totais do browser são apenas expectativa e mismatch retorna conflito.

## 7. T-order (C3)

Uma função/procedure `SECURITY INVOKER`, uma transação local:

1. obtém idempotência de order por `(store, checkout_session, request_key)` e
   compara request_hash;
2. bloqueia session, cart, items, quote e reservations;
3. exige session `ready`, version esperada e não expirada;
4. exige cart `locked`, mesma store/currency/version;
5. valida todas as reservations `active`, quantidade e expiry;
6. valida quote selecionada, fingerprint e expiry;
7. recalcula aritmética e valida snapshots de price;
8. muda session `ready -> submitting` por CAS;
9. aloca número no contador da store;
10. cria order `pending_payment`, items, addresses e adjustments imutáveis;
11. associa as reservations existentes ao order, sem confirmar estoque;
12. cria primeiro status event;
13. marca session `order_created` e cart `converted`;
14. commit.

Retry após resultado ambíguo consulta pela chave/session e retorna o mesmo order
se hash coincidir. Hash divergente retorna conflito. Não há chamada externa nem
outbox em B3-C; B3-G adicionará outbox sem ser pré-requisito do commit local.

Depois do order, reservations permanecem `active`. B3-D cria payment ledger;
sucesso validado do pagamento futuramente confirma inventory. Cancelamento não
pago libera. Pagamento tardio nunca confirma reservation expirada: tenta nova
reserva atômica; sem saldo, vai a intervenção/compensação, sem overselling.

## 8. Segurança, ownership e LGPD

- UUID, order number e checkout ID não concedem acesso;
- guest usa capability aleatória, armazenada somente como fingerprint/HMAC e
  vinculada a store/session; registered customer exige sessão e customer_id;
- browser não recebe grants e nunca escreve diretamente;
- `persi_app` cria/lê checkout e order pelo backend; `persi_worker` executa
  expiração/transições; `persi_readonly` não acessa checkout/contact/address e
  recebe no máximo futura view mascarada de orders;
- `anon`, `authenticated` e `public`: sem grants/policies/function execute;
- todas as tabelas têm RLS; policies apenas para roles técnicas mínimas;
- checkout/contact/address temporários são cifrados com chave fora do banco e
  expiram/purgam após janela operacional;
- order contact/address têm retenção fiscal/legal separada e imutabilidade;
  anonimização somente quando base legal permitir, por workflow auditado;
- logs não contêm token, email, telefone, CEP completo, documento ou endereço;
- CPF/CNPJ somente quando necessário, cifrado + HMAC + display mascarado.

`customer_addresses` é address book mutável/arquivável. `order_addresses` é
histórico independente: edição ou arquivamento do endereço do cliente nunca muda
o pedido.

## 9. Multi-store e integrações

Store é obrigatória em cart, checkout, quote e order. FKs compostas/validação
transacional impedem troca de store. Price-list, currency, inventory location e
quote devem pertencer à configuração da mesma store. Numeração e idempotência
são store-scoped. O desenho funciona para Persi e futura Loja do Gesseiro sem
criar registros nesta fase.

Order commit não depende do Olist. B3-G gravará outbox no mesmo commit e worker
assíncrono criará `external_mappings`. Woo order ID será mapping legado durante
cutover; nenhum Woo order é importado em B3-C. Payments são integralmente B3-D.

## 10. Divisão de implementação

### B3-C1 — checkout foundation

- enums e três tabelas de checkout;
- FK de reservation para checkout item;
- idempotência, price/item snapshot, quote snapshot, RLS/grants;
- funções de criação, readiness, cancelamento e expiração;
- Drizzle, pgTAP e testes locais; runtime dark.

### B3-C2 — immutable order ledger

- contador em stores, orders, items, addresses, adjustments e status events;
- FK de reservation para order;
- constraints de totals, imutabilidade, status e RLS/grants;
- função de alocação e transição; Drizzle/pgTAP; runtime dark.

### B3-C3 — integração transacional

- orquestração T-checkout/T-order reutilizando inventory;
- locks/CAS/idempotência, cart locked/converted e expiry release;
- repositórios server-only e testes E2E locais;
- nenhum provider, rota pública ou cutover.

C1 e C2 são migrations separadas porque checkout temporário/reservas e ledger
histórico possuem rollback, retenção e risco distintos. C3 pode exigir migration
própria somente para funções/constraints; não deve reescrever C1/C2 aplicadas.

Migrations propostas, ainda não criadas:

```text
202609xx..._native_checkout_foundation.sql
202609xx..._native_order_foundation.sql
202609xx..._native_checkout_order_transactions.sql
```

## 11. Plano de testes

### C1

- pgTAP de schema, checks, FKs, índices, RLS/grants e ausência de PII plaintext;
- mesma key/hash retorna sessão; hash distinto conflita;
- uma sessão ativa por cart; ownership guest/customer e isolamento de store;
- expiry e release atômico; snapshot de item/preço/frete e money bigint;
- quote/cache independentes e revalidação de fingerprints;
- double-click e cart mutation race com exatamente um vencedor.

### C2

- 20+ ciclos de numeração concorrente por store, sem duplicata;
- guest e registered order; isolamento multi-store;
- snapshots sobrevivem a alteração de catálogo/customer address;
- totals/adjustments e overflow; order idempotente/hash conflict;
- matriz de status, evento atômico e imutabilidade UPDATE/DELETE;
- RLS/grants e nenhuma exposição direta de PII.

### C3

- E2E local cart -> checkout -> price -> reservation -> order;
- dois clientes/uma unidade: exatamente um caminho reserva/cria, outro recebe
  `insufficient_inventory`, overselling zero;
- double-click do mesmo customer retorna um order;
- falha na segunda de várias reservas faz rollback total;
- checkout/reservation/quote expirados falham e liberam corretamente;
- cart alterado/version mismatch e shipping fingerprint mismatch conflitam;
- mesma key/payload diferente conflita;
- retry após resultado local ambíguo recupera o mesmo order;
- regressão integral de PIM, catalog, pricing, B3A, B3B, shipping e inventory.

## 12. Decisões e blockers

Não há blocker estrutural para C1. Antes de implementar, a configuração que
resolve `store -> price_list` deve ser explicitada de forma inequívoca; a opção
recomendada é FK/configuração versionada da store, não heurística por priority.
Isso pode ser fechado dentro do design detalhado C1 e não exige decisão comercial.

Não bloqueiam C1/C2: TTL final de PIX/boleto, captura de cartão, prefixo visual
final do pedido, contrato futuro de preço com Olist e prazo jurídico definitivo.
São políticas configuráveis antes do cutover.

## 13. Gates C0

- migration criada: NÃO
- schema/runtime alterado: NÃO
- staging write: 0
- production access/write: 0
- Woo/Olist/OpenAI/PSP/shipping provider calls: 0
- native cart runtime: DISABLED
- Woo runtime: ACTIVE/UNCHANGED
