# Pedidos, checkout e pagamentos

## Fronteira e compatibilidade

Orders registra venda histórica; Payments registra intenção/movimentos
financeiros; Checkout apenas orquestra. Até write cutover, `WC_Order`,
`wp_persi_checkout_attempts`, Banco Inter e PagBank atuais continuam oficiais.
Mappings devem ligar tentativas/pedidos/referências antigos às entidades novas.

## Criação idempotente

```text
validate request/cart
  -> acquire idempotency(scope=checkout.create, key, request_hash)
  -> price + stock + shipping server-side
  -> reserve stock
  -> create order snapshots
  -> insert outbox(order.created)
  -> commit
  -> create/recover payment using provider idempotency/reference
```

Mesmo `scope + key + request_hash` retorna o recurso já criado. Mesma chave com
payload diferente retorna conflito. Falha antes do commit não deixa pedido;
falha após pedido e antes da cobrança é recuperável pelo worker/retry, não cria
outro pedido. Chaves separadas protegem `order.create`, `payment.create`,
`payment.capture`, `refund`, `webhook.process` e `erp.sync`.

## Totais e snapshots

Money é `bigint` minor units + moeda. Equação:

```text
subtotal = sum(item subtotal)
grand_total = subtotal - discount_total + shipping_total + tax_total + fee_total
```

Checks impedem valores negativos indevidos e fechamento divergente. Em order:

- items: product/variant IDs anuláveis; nome, SKU, GTIN, marca, texto da
  variação, quantity, unit list/sale price, discount, tax e line total;
- addresses: billing/shipping completos necessários à entrega/fiscal, separados
  do endereço mutável do cliente;
- shipping: provider/carrier/service, rate ID externo, custo e prazo prometido;
- payment: provider/method, amount/currency/installments, external reference e
  status no momento; transações preservam eventos financeiros posteriores.

Snapshots não são atualizados por mudanças de product/customer/method. Correção
de pedido é evento administrativo auditado ou documento de ajuste, não refresh
do catálogo.

## Máquinas de estado independentes

### Order status

`draft -> pending_payment -> confirmed -> processing -> completed`

- `pending_payment -> cancelled|expired`
- `confirmed|processing -> cancelled` somente por caso de uso autorizado e
  efeitos compensatórios;
- refund não necessariamente cancela order; é refletido em payment status.

### Payment status

`not_started -> pending -> authorized -> paid`

- `pending -> expired|failed|cancelled`
- `authorized -> paid|voided|failed`
- `paid -> partially_refunded -> refunded`
- chargeback/dispute pode ser estado/evento adicional por migration aprovada.

Pix/boleto normalmente começam pending e podem expirar. Cartão pode passar por
authorized/capture ou chegar paid conforme contrato PagBank. Provider status é
armazenado separadamente e mapeado para o status canônico.

### Fulfillment status

`unfulfilled -> reserved -> preparing -> partially_shipped|shipped -> delivered`

- antes de shipped: pode ir a `cancelled` com liberação;
- devolução: `return_requested -> partially_returned|returned` como extensão
  controlada, sem reescrever pagamento.

Transições usam compare-and-set/estado esperado, transação, actor/source,
timestamp e `order_status_history`. Eventos duplicados são no-op idempotente;
transição inválida é rejeitada e auditada.

## Pagamento provider-neutral

`payments` possui order, provider (`BANCO_INTER|PAGBANK` inicialmente), method
(`PIX|BOLETO|CREDIT_CARD`), status, amount, currency, installments, external
reference e timestamps. `payment_transactions` representa authorize, capture,
charge, refund, void e fee com valor/status/referência.

Dados específicos permitidos quando necessários:

- Pix: txid, expiration e status; QR dinâmico preferencialmente efêmero/derivado,
  não duplicado indefinidamente.
- Boleto: request reference, due date, barcode/linha digitável e URL confiável
  do PDF com política de retenção.
- Cartão: provider token/reference, bandeira e last4 quando permitido,
  installments, authorized/captured/refunded amounts.

Proibido: PAN completo, CVV, private keys e access tokens.

## Webhook inbox

1. validar limite de tamanho, provider e autenticidade;
2. iniciar transação e inserir `webhook_events`;
3. deduplicar por `(provider, external_event_id)`; se provider não fornecer ID
   confiável, usar hash canônico + tipo + janela documentada;
4. commit e ACK rápido;
5. worker claim atômico, busca o estado atual no provider quando necessário,
   aplica transição idempotente e marca processed;
6. falha agenda retry com backoff/jitter; poison event vai para dead-letter
   lógico/alerta após limite.

Payload bruto não é requisito: armazenar hash e subset normalizado; conteúdo
com PII só quando indispensável, cifrado e com TTL.

## Transactional outbox

Recomendada. Mudança `payment.paid` atualiza payment/order e insere
`outbox_events` na mesma transação. Worker entrega a Olist, e-mail, cache/search
ou analytics; consumidores deduplicam `event_id`. Claim usa status/lease e
`FOR UPDATE SKIP LOCKED`. Entrega é at-least-once, portanto handlers precisam ser
idempotentes. Não introduzir Kafka; polling PostgreSQL controlado basta na V1.

## Estoque e métodos de pagamento

- Cartão: reserva antes da autorização; confirma venda após sucesso; falha libera.
- Pix: reserva expira alinhada à cobrança; pagamento tardio após liberação exige
  reconciliação/manual, não estoque negativo automático.
- Boleto: política de duração/estoque exige decisão comercial humana antes do
  write cutover, pois reservar por dias pode bloquear venda.
- Cancelamento/refund financeiro não implica automaticamente retorno físico ao
  estoque; recebimento/devolução governa `on_hand`.

## Reconciliação

Jobs consultam pedidos pendentes e providers por reference, com correlation ID.
Comparam amount/currency/status, nunca confiam só no webhook. Divergência cria
integration error/alerta e não força transição financeira destrutiva.

## Decisões humanas antes do write cutover

- momento de confirmação de pedido por método;
- duração de reserva Pix e, especialmente, boleto;
- captura automática/manual de cartão e política de parcelamento;
- regras de cancelamento, refund, pagamento tardio e devolução;
- formato/numeração fiscal do `order_number`.
