# Native Commerce Core — desenho definitivo (Fase B.2)

> Status: **DESIGN ONLY**. Este documento não cria migrations, não altera o
> schema Drizzle e não autoriza writes, cutover ou ativação de integrações.
> Evidência-base: migrations locais 18/18, schemas em `lib/db/schema`, checkout
> Woo atual, integrações de pagamento e fundação de frete reconciliada em B.1.

## 1. Resumo executivo

O PostgreSQL será o sistema transacional de registro do comércio. Catálogo/PIM,
ERP, PSP e transportadora continuam domínios separados e comunicam-se por inbox,
outbox, mappings e reconciliação. O checkout nunca dependerá sincronicamente do
Olist. IDs externos nunca serão PKs locais.

A implementação deve introduzir 18 tabelas de domínio: `stores`, `customers`,
`customer_identities`, `customer_addresses`, `carts`, `cart_items`,
`checkout_sessions`, `checkout_session_items`, `checkout_shipping_quotes`,
`orders`, `order_items`, `order_addresses`, `order_adjustments`,
`order_status_events`, `payment_attempts`, `payment_events`, `refunds` e
`integration_outbox`. As tabelas existentes de catálogo, preço, inventário,
integração, PIM e frete são reutilizadas.

Decisões estruturais:

- `stores` representa storefront/canal de venda; uma loja pode compartilhar ERP
  e estoque com outras lojas.
- cliente comercial e identidade de autenticação são separados; guest checkout
  cria pedido sem exigir conta.
- o checkout session possui as reservas; o pedido assume sua referência no
  fechamento atômico, sem recriar reserva.
- itens, endereços, preços e frete do pedido são snapshots imutáveis.
- pedido, pagamento e remessa têm máquinas de estado independentes.
- eventos financeiros/logísticos são append-only; o estado corrente é projeção
  transacional auditável.
- `integration_inbox` será ampliada, não duplicada; `integration_outbox` é nova
  e resolve o dual-write do commit local com exportação Olist.

## 2. Fundação reutilizada

| Componente atual | Uso definitivo | Ajuste futuro necessário |
| --- | --- | --- |
| `products`, `product_variants` | referências navegáveis e validação de venda | nenhum dado histórico depende delas |
| `price_lists`, `prices`, `price_history` | cálculo server-side | opcionalmente escopo por store/channel em fase própria |
| `inventory_locations`, `inventory_levels` | saldo físico e disponível | adicionar vínculo explícito de store apenas se operação exigir |
| `inventory_reservations`, `inventory_movements` e funções atômicas | reserva, confirmação e ledger | FK nullable para checkout/order e chave por linha de checkout |
| `shipping_methods` | catálogo de serviços | manter provider-neutral |
| `shipping_quote_cache` | otimização, nunca autoridade | nenhum checkout aponta somente ao JSON do cache |
| `shipments`, `shipment_events` | execução e timeline logística | migrar de mapping Woo para `orders.id` |
| `shipping_provider_credentials` | credencial cifrada server-only | sem exposição a admin/read-only |
| `external_mappings` | identidades Woo/Olist/PSP/frete | ampliar tipos; não guardar estado de domínio |
| `integration_inbox`, `integration_checkpoints` | ingestão deduplicada e cursores | ampliar entidades/eventos e retenção |
| tabelas PIM e `pim_audit_log` | conteúdo/editorial | não reutilizar como auditoria comercial |
| checkout attempts Woo | compatibilidade durante transição | importar/mapear apenas quando o cutover for autorizado |

## 3. Fronteiras e ownership

- **Commerce:** carts, checkout, orders, totais, reservas e visão consolidada.
- **ERP:** operação física/fiscal, após contrato Olist validado; nunca serve uma
  leitura síncrona do storefront.
- **Payment:** PSP é autoridade do fato financeiro externo; Persi registra e
  normaliza sem confiar em payload não verificado.
- **Shipping:** provider é autoridade do evento externo; Persi mantém seleção,
  custo contratado, remessa e histórico.
- **PIM/content:** atributos editoriais e publicação; não altera snapshots.

## 4. Inventário de tabelas propostas

Classificação: **N** não sensível, **P** pessoal, **SO** sensível operacional,
**S** segredo. Nenhuma tabela proposta armazena credenciais de PSP.

| Tabela | Propósito e campos-chave | Relações/constraints principais | Classificação, escrita/leitura e retenção |
| --- | --- | --- | --- |
| `stores` | canal: `id`, `code`, `name`, `status`, `default_currency`, timezone | PK UUID; UNIQUE `code`; currency ISO | N; configuração por admin, leitura app; soft-disable, permanente |
| `customers` | perfil comercial: `id`, `status`, `type`, `email`, `phone`, `tax_id_ciphertext`, timestamps, `anonymized_at` | FK store opcional via associação futura; email normalizado indexado, não necessariamente globalmente único | P/SO; servidor/admin restrito; anonimizar após base legal |
| `customer_identities` | liga auth ao perfil: `customer_id`, `issuer`, `subject`, `email_verified_at` | PK UUID; FK customer RESTRICT; UNIQUE `(issuer,subject)` | P/SO; auth server-only; apagar/desvincular após encerramento salvo retenção |
| `customer_addresses` | endereço reutilizável, label/tipo e campos postais | FK customer RESTRICT; CHECK UF/CEP/país; índice customer/status | P/SO; cliente e admin autorizado; soft-delete e purge por política |
| `carts` | carrinho guest/auth: owner token hash, customer, store, currency, status, expiry, version | FK store/customer; UNIQUE owner token hash ativo; CHECK currency | SO (token hash), P indireto; app server-only; TTL curto e purge |
| `cart_items` | variante, quantidade, timestamps; price preview opcional | FK cart CASCADE, variant RESTRICT; UNIQUE `(cart_id,variant_id)`; quantity > 0 | N; servidor; acompanha cart |
| `checkout_sessions` | coordena freeze: cart, owner, idempotency, request hash, state, expiry, address input cifrado/normalizado, totals version | FK cart/store/customer; UNIQUE `(store_id,idempotency_key)`; optimistic version | P/SO; checkout server-only; TTL operacional, depois minimização |
| `checkout_session_items` | snapshot temporário de variante, qty, preço calculado e fingerprint | FK session CASCADE, variant RESTRICT; UNIQUE session+variant; checks monetários | N; pricing/checkout; TTL da sessão |
| `checkout_shipping_quotes` | cotação selecionável: provider/service/carrier, valor, prazo, destino, fingerprint/version, quoted/expiry | FK session CASCADE e method SET NULL; UNIQUE `(session_id,quote_key)` | P (CEP), N; server-only; retenção curta, seleção copiada ao pedido |
| `orders` | agregado: UUID, store, customer nullable, número, estados, moeda, totais, correlation, timestamps | UNIQUE `(store_id,order_number)` e `(store_id,checkout_session_id)`; FKs RESTRICT/SET NULL; checks | P indireto/SO; checkout e operações; retenção fiscal/legal, nunca cascade |
| `order_items` | snapshot imutável do vendido, incluindo IDs nullable, SKU/GTIN/nome/variante, qty e dinheiro | FK order RESTRICT, product/variant SET NULL; line number UNIQUE; qty > 0 | N; criado no fechamento, lido admin/cliente; mesma retenção do pedido |
| `order_addresses` | snapshot billing/shipping: recipient/company/documento quando necessário e endereço | FK order RESTRICT; UNIQUE `(order_id,address_type)`; type billing/shipping | P/SO; checkout e fiscal/logística; retenção legal, anonimização condicionada |
| `order_adjustments` | cupom, promoção, desconto de pagamento, frete, manual, arredondamento | FK order e item nullable RESTRICT; signed amount; type/scope/source/reference | N/SO; motor/admin autorizado; imutável, reversão por nova linha |
| `order_status_events` | ledger append-only de transições, actor, motivo e correlation | FK order RESTRICT; from/to; UNIQUE source event quando externo | SO; casos de uso autorizados; retenção do pedido |
| `payment_attempts` | uma tentativa de cobrança: order, provider/method, status, amount, installments, idempotency, provider ref, safe card metadata, expiry | FK order RESTRICT; UNIQUE `(provider,idempotency_key)` e parcial `(provider,provider_reference)` | SO; payment service/finance; retenção financeira, sem PAN/CVV/token reutilizável |
| `payment_events` | fatos append-only e status raw/normalizado, valores e hash | FK attempt RESTRICT; UNIQUE `(provider,external_event_id)` quando presente | SO; inbox/worker; retenção financeira; payload mínimo/redigido |
| `refunds` | pedido/tentativa, valor, status, reason, idempotency e provider ref | FK order/attempt RESTRICT; UNIQUE provider idempotency/ref; amount > 0 | SO; finance autorizado; retenção financeira |
| `integration_outbox` | evento garantido no mesmo commit: aggregate, type, payload mínimo, dedup, status/lease/retry | UNIQUE `event_id`, `(destination,dedup_key)`; SKIP LOCKED indexes | SO conforme payload; serviços/workers; purge após janela e auditoria |

### Campos comuns

Todas as entidades mutáveis têm `created_at`, `updated_at` e, quando aplicável,
`version bigint >= 0`. Eventos append-only têm `created_at` e não recebem
`updated_at`. IDs públicos usam UUID aleatório ou número público; nunca sequência
interna exposta como segredo de autorização.

## 5. Modelo ER textual

```text
stores 1 ── N carts
stores 1 ── N checkout_sessions
stores 1 ── N orders
customers 1 ── N customer_identities
customers 1 ── N customer_addresses
customers 1 ── N carts (nullable owner)
customers 1 ── N orders (nullable snapshot origin)
carts 1 ── N cart_items ── 1 product_variants
carts 1 ── N checkout_sessions
checkout_sessions 1 ── N checkout_session_items
checkout_sessions 1 ── N checkout_shipping_quotes
checkout_sessions 1 ── N inventory_reservations
checkout_sessions 1 ── 0..1 orders
orders 1 ── N order_items
orders 1 ── 1..2 order_addresses
orders 1 ── N order_adjustments
orders 1 ── N order_status_events
orders 1 ── N payment_attempts
orders 1 ── N refunds
orders 1 ── N shipments
payment_attempts 1 ── N payment_events
orders/payment/shipments ── N integration_outbox
external_mappings N ── 1 entidade interna (validada pelo serviço)
```

## 6. Cliente, identidade e LGPD

`customers` não copia `wp_users`. Uma identidade (`wordpress`, futuro
`supabase_auth`, Google etc.) aponta ao mesmo perfil. Guest order deixa
`customer_id` nulo, mas preserva somente os dados necessários nos snapshots.
Email não será identidade universal: pode mudar, repetir entre lojas ou chegar
de guest. Para busca, usar coluna normalizada com acesso restrito; para dedupe,
regra explícita e nunca merge automático apenas por email.

CPF/CNPJ só é coletado quando fiscal/PSP exigir. Recomendação: valor cifrado na
aplicação e fingerprint HMAC separado para busca/deduplicação autorizada; chave
fora do banco. Documento mascarado pode existir em snapshot quando necessário.

Pedidos e eventos sujeitos a retenção fiscal não são apagados por pedido LGPD;
o perfil e endereços reutilizáveis são anonimizados/desvinculados quando não há
base legal. Logs não contêm nome, email, telefone, CEP completo, documentos,
tokens ou payloads brutos. Acesso a PII exige permissão, motivo e auditoria.

## 7. Carrinho

Carrinho armazena quantidade e, opcionalmente, preview de preço apenas para UX.
Preview nunca é autoridade. Guest ownership usa token aleatório no cookie
HTTP-only; banco recebe apenas hash. Login faz merge transacional determinístico:
somar quantidades até o limite comprável, preservar cupons válidos, invalidar
frete e marcar o guest cart como `merged`. Estados: `active`, `locked`,
`converted`, `abandoned`, `expired`. Expiração é renovada por atividade com teto.

## 8. Checkout session

Checkout é separado do cart e order. Ao criar, copia itens, versões de preço e
fingerprints; alterações posteriores no cart invalidam a sessão. Estados:

```text
open -> validating -> ready -> submitting -> order_created
open|validating|ready -> expired|cancelled
submitting -> ready (somente falha anterior ao commit)
```

Mesmo `(store,idempotency_key)` + mesmo `request_hash` retorna a sessão/pedido;
hash diferente é `409 conflict`. A sessão é dona inicial das reservas. O commit
do pedido liga as mesmas reservas ao order; não reserva novamente.

## 9. Pedido e numeração

`orders.id` é UUID interno. Número humano é **store-scoped**, gerado no banco por
uma sequência dedicada por store/alocador transacional e formatado, por exemplo,
`PM-2026-000123`. Não deriva de `count(*)`, não é PK e gaps são aceitáveis.
`UNIQUE(store_id,order_number)` é a autoridade. O formato exato/prefixo é
configurável e precisa de aprovação fiscal antes de B.3, sem alterar o modelo.

Campos de total em minor units `bigint`: `items_subtotal_minor`,
`discount_total_minor`, `shipping_total_minor`, `tax_total_minor`,
`fee_total_minor`, `grand_total_minor`. Moeda ISO-4217 acompanha todos os fatos.

### Snapshot do item

Obrigatórios: `line_number`, IDs de catálogo nullable, `sku_snapshot`, GTIN
nullable, `product_name_snapshot`, marca/descrição de variante nullable,
quantidade, `unit_list_amount_minor`, `unit_sale_amount_minor`,
`discount_amount_minor`, `tax_amount_minor`, `line_total_minor`, currency e
fingerprint da origem. Após `placed_at`, snapshots não são atualizados.

### Endereço e ajustes

Um pedido tem exatamente um shipping e um billing snapshot quando aplicável;
`UNIQUE(order_id,address_type)`. Mesmo endereço pode ser copiado duas vezes para
preservar semântica. Ajustes são linhas assinadas com tipo, escopo order/item,
código/referência e actor. Correção/reversão cria outro ajuste/evento.

### Invariantes de dinheiro

```text
item_subtotal = unit_sale_amount * quantity
line_total = item_subtotal - line_discount + line_tax
items_subtotal = sum(item_subtotal)
discount_total = sum(descontos positivos representando redução)
grand_total = items_subtotal - discount_total + shipping_total + tax_total + fee_total
payment_attempt.amount <= saldo devido na criação (salvo política explícita)
sum(refund concluído) <= sum(payment capturado/pago)
```

Valores não negativos onde representam magnitude; ajustes usam sinal e tipo
validados. Cálculo é exclusivamente server-side e deve ser refeito dentro de T1.

## 10. Máquinas de estado

### Order

Estados mínimos: `pending_payment`, `paid`, `processing`, `ready_to_ship`,
`shipped`, `delivered`, `cancelled`. `payment_failed` é estado do pagamento,
não do pedido; pedido pode continuar `pending_payment` para nova tentativa ou ser
cancelado por política. Refund também não reescreve fulfillment.

Transições: `pending_payment -> paid|cancelled`; `paid -> processing|cancelled`;
`processing -> ready_to_ship|cancelled`; `ready_to_ship -> shipped|cancelled`;
`shipped -> delivered`; exceções/retornos entram por eventos operacionais
auditados. Toda transição usa compare-and-set pelo estado esperado.

### Payment

`created -> pending|authorized|paid|failed`; `pending -> paid|failed|expired|cancelled`;
`authorized -> paid|voided|failed`; `paid -> partially_refunded|refunded`;
`partially_refunded -> partially_refunded|refunded`. Raw provider status é
preservado separadamente. PIX/boleto normalmente ficam pending; cartão pode
pular `authorized` se o PSP captura imediatamente.

### Refund

`requested -> processing -> succeeded|failed|manual_review`; `failed ->
processing` apenas por nova tentativa explicitamente idempotente. Múltiplos
refunds parciais são permitidos até o capturado.

### Inventory reservation

Reutiliza `active -> confirmed|released|expired|cancelled`; estados terminais
não reabrem. Nova tentativa cria nova reserva. `confirmed` reduz `on_hand` e
`reserved` uma única vez pela função existente.

### Shipment e integração

Shipment reutiliza o enum atual e timeline append-only. Outbox:
`pending -> processing -> completed`; falha transitória `processing -> retry ->
processing`; limite -> `dead_letter`, requeue manual auditado. Inbox mantém a
mesma semântica atual.

## 11. Payment ledger, segurança e idempotência

`payment_attempts` é provider-neutral, mas inclui `provider_reference` para
consulta e unicidade. `external_mappings` pode manter compatibilidade/lookup
cross-system, não substitui essa referência. Dados seguros de cartão limitam-se
a bandeira, last4, parcelas e referência opaca não reutilizável quando permitido.
PAN, CVV, token sensível, segredo, certificado e chave privada são proibidos.

Proteções exatas:

- double-click/refresh: idempotency da checkout session e UNIQUE por store;
- criação PSP: UNIQUE `(provider,idempotency_key)` e mesma chave enviada ao PSP;
- timeout desconhecido: estado `pending/unknown`, requery por referência/chave;
- webhook duplicado: `integration_inbox` dedupe por source/event ID; fallback de
  hash canônico + tipo + entidade quando provider não fornece ID confiável;
- worker retry: claim com lease e `FOR UPDATE SKIP LOCKED`;
- provider reference: índice UNIQUE parcial por provider;
- transition: update condicional `WHERE status = expected` e evento no mesmo tx.

Webhook: autenticar/limitar -> persistir e deduplicar no inbox -> ACK rápido ->
worker reconsulta provider quando necessário -> compara amount/currency/order ->
transiciona e audita. Corpo do webhook nunca é prova suficiente de pagamento.

## 12. Inventário: ciclo e fronteira transacional

- Cart: não reserva.
- Checkout `ready/submitting`: reserva cada inventory level por prazo curto.
- Cartão: reserva antes da chamada; falha confirmada libera; timeout mantém até
  reconciliação/TTL.
- PIX: reserva vence junto ou pouco após a cobrança. Expiração verificada libera.
- Boleto: recomendação é **não bloquear saldo físico por dias**; usar reserva
  curta e tratar pagamento posterior por reconciliação/manual. Política comercial
  final de duração é open question de B.3.
- Pagamento confirmado: confirma reservas atomicamente e emite outbox.
- Cancelamento antes da confirmação: libera. Refund não repõe estoque; somente
  devolução física/ajuste autorizado gera `return`.
- Pagamento tardio após release: nunca força saldo negativo. Tenta nova reserva
  atômica; sem saldo, order vai para intervenção/compensação financeira.

As funções atuais já bloqueiam `inventory_levels` e impedem
`reserved > on_hand`. B.3 deverá permitir uma reserva por linha/nível com UNIQUE
`(checkout_session_id,inventory_level_id)` e idempotency por item.

## 13. Frete

A seleção persistida em `checkout_shipping_quotes` contém provider, external
service code, carrier/service names, amount/currency, prazo, CEP destino,
fingerprint logístico (itens, dimensões, origem/destino e versão de regra),
`quoted_at`, `expires_at` e raw reference segura. Cache JSON é apenas origem
efêmera. T1 rejeita quote expirada ou fingerprint divergente; se reprice mudar,
retorna ao usuário para consentimento, sem trocar silenciosamente.

Após criação de orders, `shipments.order_id UUID NOT NULL REFERENCES orders(id)
ON DELETE RESTRICT` será o vínculo nativo. Migração segura futura:

1. adicionar `order_id` nullable;
2. backfill somente mappings inequívocos, com relatório;
3. dual-read controlado e validação;
4. tornar NOT NULL para remessas nativas;
5. manter `order_mapping_id` somente para legado ou mover o Woo ID a
   `external_mappings`; remover a dependência após cutover verificado.

Antes de existir external ID, impedir duplicata por UNIQUE parcial
`(order_id,provider,shipping_method_id,fulfillment_sequence)` para remessa ativa.
`fulfillment_sequence` suporta split shipment. Depois, UNIQUE parcial
`(provider,external_shipment_id)` permanece. Timeout após criação externa exige
requery por idempotency/protocolo, nunca segunda criação cega.

## 14. Olist: matriz de autoridade

| Domínio | Direção alvo | Autoridade |
| --- | --- | --- |
| produto/conteúdo editorial | PERSI -> OLIST | Persi PIM após cutover |
| SKU | PERSI -> OLIST | Persi catálogo; mudança auditada |
| GTIN | OLIST -> PERSI candidato; PERSI -> OLIST aprovado | Persi canônico após reconciliação |
| preço storefront | OLIST -> PERSI sinal operacional ou PERSI -> OLIST conforme contrato final | Persi Pricing atende o site; ownership comercial precisa ser confirmado |
| estoque físico por depósito | OLIST -> PERSI | Olist ERP; Persi mantém reservas e `available` |
| pedido | PERSI -> OLIST | Persi |
| status financeiro | NOT SYNCHRONIZED como autoridade | PSP/Persi, nunca Olist |
| status operacional do pedido | OLIST -> PERSI | Olist para operação; Persi normaliza |
| shipping/tracking | BIDIRECTIONAL por eventos distintos | Persi agrega; fonte do evento preservada |
| NFe/referência fiscal | OLIST -> PERSI | Olist |

Não há ownership bidirecional do mesmo campo. Preço é a única decisão contratual
pendente; até resolvida, nenhum worker escreve preço em qualquer direção.

Order export é assíncrono: T1 grava `order.created` na outbox. Worker envia
snapshot mínimo ao Olist, usando `event_id/order.id` como idempotency, grava
mapping e conclui. Estados/retries/leasing seguem outbox; indisponibilidade do
Olist nunca desfaz a venda local. Dead-letter exige intervenção e mantém pedido.

## 15. Inbox, outbox, mappings e correlação

Ampliar `integration_inbox.entity_type` para order/payment/shipment/inventory e
preservar payload hash/subset seguro. `integration_checkpoints` continua para
polling/reconciliação. Criar `integration_outbox` porque somente ela pode ser
gravada na mesma transação do agregado e eliminar o dual-write.

`external_mappings` guarda identidade estável (`system`, `entity_type`, IDs),
incluindo Woo legado e Olist. PSP IDs críticos também ficam na tabela nativa para
unicidade e reconciliação; mappings dão navegação cross-system. Status, amount,
tentativas, erros e payload não pertencem a mappings.

Um `correlation_id UUID` nasce na checkout session e segue order, reservations,
payment attempts, shipment, inbox/outbox e logs. IDs de cada agregado continuam
próprios. Admin poderá reconstruir timeline sem consultar provedores.

## 16. Mapa de transações

| Tx | Dentro de uma transação PostgreSQL | Fora da transação |
| --- | --- | --- |
| T0 cart merge | lock dos dois carts, merge itens, expira guest | nada |
| T1 checkout/order/reservation | lock session/cart; reprice; valida quote; reserva níveis em ordem determinística; cria order/snapshots/adjustments; liga reservas; status/event; outbox; converte cart | nenhuma API externa |
| E1 payment create | chamada PSP com idempotency após commit T1 | somente PSP |
| T2 payment reference | CAS attempt, persiste referência/evento seguro e outbox | nenhuma API |
| T3 payment success | dedupe inbox/event; lock attempt/order/reservas; valida amount/currency; confirma inventory; muda payment/order; eventos/outbox | requery PSP ocorre antes |
| T4 failure/expiry | lock attempt/order/reservas; CAS; libera; eventos/outbox | nenhuma API |
| T5 refund request | valida saldo, cria refund/idempotency e outbox operacional | chamada PSP depois |
| T6 refund result | evento dedupe, atualiza refund/payment e audit/outbox | requery antes quando necessário |
| T7 shipment create result | associa external ID/protocolo por CAS, cria event | chamada provider antes |
| T8 Olist export result | mapping + conclusão de outbox/inbox | chamada Olist antes |

Locks seguem ordem session/order -> inventory levels ordenados por UUID ->
payment/reservations, reduzindo deadlocks. APIs externas nunca mantêm locks.

## 17. Concorrência e recuperação de falhas

| Cenário | Recuperação segura |
| --- | --- |
| A. Order commit, payment API falha | order fica pending; attempt retryable; retry usa a mesma key; falha definitiva libera por T4 |
| B. PSP succeed, Next timeout | marcar resultado desconhecido; requery por key/reference; não cobrar novamente |
| C. webhook duplicado | UNIQUE inbox/event retorna no-op; CAS impede segunda transição |
| D. PIX após expiração | verificar PSP; tentar nova reserva; sem estoque, manual review/refund, nunca oversell |
| E. duas compras da última unidade | `reserve_inventory` serializa/UPDATE condicional; uma falha antes do order commit |
| F. order commit, Olist offline | outbox persiste; backoff/retry/dead-letter; checkout permanece concluído |
| G. quote expira | T1 rejeita; nova cotação e consentimento do cliente |
| H. shipment externo criado, timeout local | requery por idempotency/protocolo e upsert; constraint impede duplicata local |
| I. cancelamento e webhook simultâneos | lock order/payment + CAS; fato pago vence como financeiro, cancelamento vira fluxo compensatório/manual |

## 18. Constraints, delete e retenção

Correctness não fica só no TypeScript. Migrations B.3 deverão conter FKs,
UNIQUEs e CHECKs citados; índices por `(store,status,created_at,id)`, customer,
order number, provider reference, work queues e expiry. Transições complexas
devem passar por funções SQL `SECURITY INVOKER`/procedures com estado esperado;
triggers ficam para imutabilidade/eventos simples, não para orquestração oculta.

- catálogo -> order item: `SET NULL`; snapshots permanecem;
- customer -> order: `SET NULL` após anonimização autorizada;
- customer -> reusable address/identity: RESTRICT durante operação, purge
  explícito; não cascade para order;
- order -> items/addresses/payments/refunds/shipments/events: RESTRICT, sem delete
  operacional;
- cart -> items e checkout temp -> temp children: CASCADE após TTL;
- payment/shipment event: RESTRICT ou cascade apenas em purge administrativo
  impossível enquanto pai retido; preferir RESTRICT;
- integração concluída: payload mínimo pode expirar; metadados de dedupe/audit
  ficam pela janela operacional definida.

## 19. Auditoria e administração futura

Criar ledger comercial separado (`order_status_events` e eventos dos domínios),
com actor type/id, source, reason, previous/new state, correlation e timestamp.
Mudanças manuais sempre exigem permissão e motivo. Não reutilizar `pim_audit_log`.

Admin futuro, sem implementação nesta fase:

| Área | Leitura/filtros | Ações e permissão mínima |
| --- | --- | --- |
| orders | número, status, cliente mascarado, data | manager: transição excepcional com motivo |
| customers | busca PII restrita | support/manager: correção/anonymization workflow |
| payments/refunds | provider/status/value/reconciliation | finance: refund/requery; dual control acima de limite futuro |
| inventory | SKU/local/saldos/movimentos | warehouse: ajuste com motivo; vendas não editam ledger |
| shipping | order/status/tracking/exceções | warehouse: criar/cancelar/reconciliar shipment |
| integrations | backlog, retry, dead-letter, lag | integration operator: retry/requeue sem editar payload |

Papéis mínimos recomendados: `commerce_support` (pedido e PII mascarada),
`commerce_manager` (status/cancelamento), `finance` (pagamentos/refunds),
`warehouse` (estoque/frete), `catalog_editor`/`catalog_approver` (PIM) e
`integration_operator`. `admin` administra grants, não é usado pelo runtime.
Separar read de PII, refund, inventory adjustment e shipment mutation.

## 20. Segurança

- Browser nunca escreve tabelas diretamente; Route Handlers validam ownership e
  usam role mínima. Service role não vai ao cliente.
- Totais, frete, promoções e estoque são recalculados no servidor/T1.
- IDs públicos não autorizam acesso: toda leitura verifica customer/session
  ownership (prevenção IDOR).
- Webhooks têm autenticação quando disponível, limite, replay defense, inbox e
  requery. Segredos ficam em env/vault, nunca em mappings/logs.
- PII usa projeções mascaradas, column selection explícita, RLS/grants e audit.
- Manual actions têm RBAC, CSRF/origin protection, reason e event ledger.
- Outbox não carrega PAN, CVV, documento completo ou endereço quando o consumidor
  não precisa; payloads são versionados e minimizados.
- Logs usam correlation ID e códigos sanitizados, sem payload bruto.

## 21. Woo cutover dependency map

| Componente nativo | Dependência Woo substituída no futuro |
| --- | --- |
| customers/identities/addresses | WordPress users e customer endpoints |
| carts/items | Woo Store API cart e Cart-Token |
| checkout sessions | `wp_persi_checkout_attempts` e parte da orquestração Woo |
| orders/items/addresses/adjustments | REST `wc/v3/orders`, WC_Order/meta/lines |
| payment attempts/events/refunds | metas Woo como ledger/reconciliation anchor |
| inventory reservation linkage | estoque/reserva implícita Woo no checkout |
| shipping quote snapshot | sessão/rates Woo como autoridade final |
| shipments.order_id | mapping provisório para WC_Order |
| outbox/Olist export | integração ERP mediada por Woo/plugins |

O cutover será por feature flag/canary e domínio, nunca removendo Woo em B.2/B.3.

## 22. Plano B.3 em subfases

1. **B.3-A — tenancy e clientes:** enums, `stores`, customers, identities,
   addresses, RLS/grants e pgTAP; sem runtime.
2. **B.3-B — carts:** carts/items, ownership hash, merge/expiry functions e
   concorrência local; sem cutover.
3. **B.3-C — checkout/orders:** sessions, quote/item snapshots, orders,
   snapshots, adjustments, status events, numbering e invariants; dry-run local.
4. **B.3-D — payment ledger:** attempts/events/refunds, idempotency, state
   functions e webhook inbox extension; zero PSP call.
5. **B.3-E — inventory integration:** FKs/reference migration, T1/T3/T4 e testes
   concorrentes/late-payment; nenhuma conexão ao checkout real.
6. **B.3-F — native shipping relationship:** `shipments.order_id`, backfill
   strategy, uniqueness pre-provider e testes; shipping runtime continua off.
7. **B.3-G — outbox/Olist foundation:** outbox, leases, dedupe, dead-letter e
   adaptador fake; zero chamada Olist.
8. **B.3-H — admin/auth contracts:** views/projections, roles e audit tests; UI
   e cutover ficam em autorização posterior.

Cada fase: migration append-only, Drizzle correspondente, pgTAP, reset local,
typecheck/lint/build, staging somente após autorização explícita e backup.

## 23. Decisões

### DECIDED

- PostgreSQL é SoR transacional; Olist é assíncrono.
- store-scoped order number com constraint e alocação concorrente segura.
- guest e registered customer; identity separada do profile.
- checkout session, cart e order são agregados distintos.
- checkout session é dona inicial da reserva.
- snapshots imutáveis de item/endereço/frete; BIGINT minor units.
- estados separados para order/payment/refund/reservation/shipment.
- reuse de inventory, shipping, mappings, inbox e checkpoints.
- nova transactional outbox; audit comercial separado do PIM.
- shipment terá FK nativa a order e identity pre-provider.
- zero chamada externa dentro de transação PostgreSQL.

### RECOMMENDED

- Olist governa `on_hand`; Persi governa reservations/available.
- boleto não reserva estoque por toda a validade; usa janela curta + reconciliação.
- CPF/CNPJ cifrado + HMAC lookup, apenas quando exigido.
- PostgreSQL polling/`SKIP LOCKED` é suficiente; sem broker distribuído agora.

### OPEN_QUESTION

1. Prazo comercial de reservas PIX e boleto e ação padrão para pagamento tardio.
2. Autoridade contratual de preço entre Olist e Persi Pricing.
3. Prefixo/formato final do número de pedido e exigências fiscais.
4. Captura automática versus autorização/captura para o futuro PSP de cartão.
5. Prazo legal exato por classe de PII/documento, a validar com jurídico/contábil.

Nenhuma questão altera a estrutura central; todas viram configuração/política
antes do write cutover.

## 24. Gates de desenho

| Gate | Resultado |
| --- | --- |
| NATIVE_COMMERCE_MODEL_COMPLETE | YES |
| ORDER_MODEL_READY | YES |
| PAYMENT_LEDGER_MODEL_READY | YES |
| INVENTORY_INTEGRATION_MODEL_READY | YES |
| SHIPPING_ORDER_MODEL_READY | YES |
| OLIST_SYNC_MODEL_READY | YES, implementação bloqueada até validar contrato |
| MULTISTORE_MODEL_READY | YES |
| SECURITY_MODEL_READY | YES |
| SAFE_TO_PREPARE_B3_IMPLEMENTATION | YES, somente após autorização explícita |

## 25. Limites desta fase

Staging writes: **0**. Produção acessada: **NÃO**. OpenAI calls: **0**.
Payment provider calls: **0**. Shipping provider calls: **0**. Olist calls:
**0**. Migration criada: **NÃO**. Runtime alterado: **NÃO**. Commit: **NÃO**.
Push: **NÃO**.
