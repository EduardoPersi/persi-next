# Notificações transacionais do Native Commerce (WhatsApp e e-mail)

Classificação desta rodada: **DESIGN_ONLY**. Nenhum código, nenhuma migration,
nenhuma chamada a provedor. O motivo está logo abaixo, na auditoria.

## 1. Auditoria: o que existe de verdade hoje

O pedido desta rodada partia de um estado que **este repositório não tem**. A
tabela abaixo é o que a auditoria encontrou, e é ela que governa o resto do
documento.

| Premissa do pedido | Situação real |
| --- | --- |
| cart / checkout / orders foundation | **não existe** no banco — sem `orders`, `order_items`, `carts` em nenhuma migration |
| payment ledger, payment events | **não existe** — sem `payments`, `payment_transactions`, `webhook_events` |
| `integration_outbox` | **não existe**. Existe `integration_inbox` (entrada, catálogo) |
| payment → order → inventory orchestration | **não existe** no nativo; o que roda hoje é TypeScript contra o WooCommerce (`services/payments/*`, `services/woocommerce/orders.ts`) |
| reservation expiration/recovery | tabela `inventory_reservations` **existe**; a orquestração que a consome, não |
| native webhook routes | as rotas em `app/api/webhooks/*` falam com Inter, PagBank e Mercado Pago **contra pedidos Woo** |
| `persi_app` / `persi_worker` | **existem**, criadas em `20260901120000_shipping_core.sql`, com grants e RLS |
| `lib/observability/nativeCommerceEvents.ts` | **não existe**; não há diretório `lib/observability/` |
| `NATIVE_CHECKOUT_MODE` | **não existe** em nenhum arquivo do repositório |

Tabelas realmente criadas: catálogo/PIM, preços, `inventory_*`,
`integration_inbox`, `integration_checkpoints`, `external_mappings`,
`shipping_*`, `shipment*`.

O que existe de orders/payments é **desenho**, não implementação:
`docs/database/02-entity-model.md` e `docs/database/06-orders-payments.md`
descrevem `orders`, `order_items`, `payments`, `payment_transactions`,
`webhook_events` e `outbox_events`. Nenhuma dessas tabelas foi criada.

### Por que isso força DESIGN_ONLY

Uma notification outbox transacional é, por definição, uma linha escrita **na
mesma transação** da mudança comercial, com chave de idempotência derivada do
pedido. Sem `orders` não há transação comercial nativa onde pendurar essa
escrita, nem `order_id` para compor a chave.

Implementar agora produziria uma tabela com FK para o vazio, um worker sem
nada para processar, e testes que só provariam que o próprio teste funciona.
O `AGENTS.md` (§7.2, abstrações prematuras; §26.2, plano antes de mexer em
pagamento) e a §27 do próprio pedido ("qualquer dúvida sobre integração com o
atual payment/order orchestration → DESIGN_ONLY e HARD STOP") apontam para o
mesmo lugar.

**A ordem correta é: `orders`/`payments` primeiro, notificações depois.** Este
documento é a peça que fica pronta para o momento em que aquela existir.

## 2. Não duplicar o outbox que já foi decidido

`06-orders-payments.md` já decidiu um **transactional outbox genérico**
(`outbox_events`): escrito na mesma transação da mudança, consumido por worker
com claim `FOR UPDATE SKIP LOCKED`, entrega at-least-once, consumidores
deduplicam por `event_id`, polling PostgreSQL sem Kafka.

Notificação **não é** um segundo outbox. É um **consumidor** do primeiro.

```
payment.paid (mesma transação)
        ↓
outbox_events                    ← já desenhado em 06-orders-payments.md
        ↓
worker de outbox
        ├── Olist
        ├── cache/search
        └── notification_intents ← o que este documento acrescenta
                 ↓
            notification_deliveries (1 por canal)
                 ↓
            worker de entrega → adapter → provider
                 ↓
            webhook de status → delivery state
```

Dois níveis, e a razão de serem dois:

- **intent** responde "este fato comercial merece avisar o cliente?" — uma por
  `(order, event_type, event_version)`;
- **delivery** responde "esta mensagem, neste canal, saiu?" — uma por
  `(intent, channel)`, com retry e estado próprios.

Sem essa separação, acrescentar e-mail depois obrigaria a reescrever a
idempotência do WhatsApp.

### Precedente estrutural a copiar

`integration_inbox` já resolve, em produção, exatamente a semântica de
confiabilidade que este desenho precisa — e deve ser copiada em vez de
reinventada:

| Coluna de `integration_inbox` | Por que serve aqui |
| --- | --- |
| `status` em `pending/processing/retry/processed/dead_letter` | mesma máquina de estados, mesmos nomes |
| `attempts integer check (attempts between 0 and 20)` | teto no schema, não só no código: retry infinito vira erro de constraint |
| `next_attempt_at` | backoff sem timer em memória |
| `locked_at` / `locked_by` | claim atômico, lease visível |
| `last_error_code` (código, não mensagem) | diagnóstico sem PII no banco |
| `payload_hash` em vez de payload | data minimization já é o padrão da casa |
| `unique (source, external_event_id)` | idempotência no schema |

## 3. Catálogo de eventos

Disponibilidade medida contra o repositório real, não contra o desejado.

| Evento | Eixo | Fonte | Disponibilidade |
| --- | --- | --- | --- |
| `ORDER_RECEIVED` | order | order status `pending_payment` | `AFTER_NATIVE_ORDERS` |
| `PAYMENT_PENDING_PIX` | payment | payment `pending`, method PIX | `AFTER_NATIVE_ORDERS` |
| `PAYMENT_PENDING_BOLETO` | payment | payment `pending`, method BOLETO | `AFTER_NATIVE_ORDERS` |
| `PAYMENT_APPROVED` | payment | payment `paid` | `AFTER_NATIVE_ORDERS` |
| `PAYMENT_FAILED` | payment | payment `failed`/`expired` | `AFTER_NATIVE_ORDERS` |
| `ORDER_PROCESSING` | fulfillment | fulfillment `preparing` | `AFTER_OLIST` |
| `ORDER_READY_FOR_PICKUP` | fulfillment | estado de retirada | `AFTER_OLIST` + decisão comercial |
| `ORDER_SHIPPED` | shipping | `shipments`/`shipment_events` | `AFTER_SHIPPING` |
| `ORDER_DELIVERED` | shipping | `shipment_events` | `AFTER_SHIPPING` |
| `ORDER_CANCELLED` | order | order `cancelled` | `AFTER_NATIVE_ORDERS` |
| `REFUND_REQUESTED` | payment | `payment_transactions` refund | `FUTURE` |
| `REFUND_COMPLETED` | payment | payment `refunded` | `FUTURE` |

`EVENTS_AVAILABLE_NOW` no nativo: **nenhum**. Não há um único evento que o
Native Commerce consiga provar hoje.

Fora do nativo existe **um** aviso já funcionando, e ele não conta para esta
arquitetura: `services/payments/reconcile.ts` chama `avisarPedido` no ponto em
que um pedido Woo vira pago, e o painel de atendimento entrega pelo WhatsApp
(`docs/42-painel-whatsapp.md`). É o caminho provisório, com o número humano da
loja, e **deve ser aposentado** quando o nativo assumir — não estendido. Nenhum
evento novo deve ser pendurado nele.

`ORDER_READY_FOR_PICKUP` depende de decisão comercial antes de existir: hoje
não há estado de "separado e esperando na loja" em lugar nenhum do domínio.
Não inventar.

## 4. Máquina de estados da entrega

Estado **interno**, que é o único que o domínio controla:

```
queued → processing → sent → delivered
                ↓        ↓
             retry    (read)
                ↓
      failed / dead_letter
```

- `queued`: delivery criada, worker ainda não pegou;
- `processing`: claim feito, lease ativo;
- `sent`: provider aceitou e devolveu um id;
- `delivered` / `read`: **só** se o provider informar; nem todo provider
  informa, e nenhum dos dois pode ser pré-requisito de nada;
- `retry`: falha transitória, com `next_attempt_at`;
- `failed`: falha permanente desta tentativa de entrega;
- `dead_letter`: teto de tentativas atingido ou falha permanente de destino.

O **estado do provider** é guardado em coluna separada, textual, sem enum: o
vocabulário é dele e muda sem aviso. Mapear para o estado interno na borda do
adapter, nunca no domínio.

Regra: `delivered` e `read` são **informativos**. Nenhuma decisão comercial
pode depender deles.

## 5. Idempotência

Duas chaves, uma por nível.

**Intent** — impede que o mesmo fato comercial vire dois avisos:

```
unique (order_id, event_type, event_version)
```

`event_version` existe para o caso legítimo de reenviar: se um dia for preciso
avisar de novo sobre o mesmo pedido e o mesmo evento (correção de texto,
mudança de política), sobe a versão — e isso é uma decisão explícita, não um
acidente de retry.

**Delivery** — impede que a mesma intenção vire duas mensagens no mesmo canal:

```
unique (intent_id, channel)
```

Retry **nunca cria linha nova**: atualiza `attempts` e `next_attempt_at` da
linha que já existe. É isso que torna impossível o cenário "webhook duplicado
do Inter → dois 'pagamento aprovado' no WhatsApp do cliente".

**Idempotência do provider**: o adapter envia uma chave derivada de
`delivery_id`, para que um timeout seguido de retry não gere duas mensagens do
lado de lá. Provider que não suporta chave de idempotência precisa ser tratado
como "envio não confirmado" em timeout — e a política para esse caso é uma
decisão humana, documentada antes de ligar (§11).

## 6. Retry

| Classe | Exemplo | Ação |
| --- | --- | --- |
| transitória | 5xx, timeout, rate limit | `retry` com backoff |
| permanente de destino | telefone inválido, sem WhatsApp | `dead_letter` direto, sem tentativa |
| permanente de conteúdo | template não aprovado, variável faltando | `dead_letter` + alerta; é bug, não instabilidade |
| ambígua | timeout depois do aceite | ver §5; nunca reenviar sem chave de idempotência |

Backoff proposto: `1min, 5min, 15min, 1h, 6h` — cinco tentativas, teto em
~7h. Os números não são arbitrários:

- o primeiro minuto cobre a indisponibilidade curta de provider;
- 6h é o ponto em que um aviso transacional deixa de ser útil ao cliente
  (avisar de "pagamento aprovado" no dia seguinte é pior que não avisar);
- cinco cabe folgado no teto de 20 que `integration_inbox` já usa no schema.

Colunas: `attempt_count`, `next_attempt_at`, `last_attempt_at`, `terminal_at`.
`terminal_at` preenchido significa "não mexer mais" — é o que o worker usa
para não varrer linha morta.

## 7. Telefone

Fronteira única, em módulo próprio, com uma regra acima de todas: **telefone
inválido nunca derruba pedido**.

- normalizar para E.164 (`+55` + DDD + número);
- aceitar o que o Brasil realmente escreve: `(11) 96446-0218`, `11964460218`,
  `+55 11 96446-0218`;
- **não inventar DDD**: número com 8 ou 9 dígitos sem DDD é `invalid_destination`,
  não "provavelmente Jundiaí";
- **não corrigir o nono dígito em silêncio**: quando o resultado for ambíguo,
  recusar e registrar, não adivinhar;
- resultado da recusa: a *delivery* nasce `dead_letter` com
  `invalid_destination`. O pedido segue confirmado, pago e entregue.

O pedido fica sem aviso de WhatsApp e isso aparece no histórico de notificações
do admin — que é onde alguém pode ligar para o cliente.

## 8. Consentimento

`TRANSACTIONAL` e `MARKETING` separados **desde a primeira migration**, mesmo
com marketing fora de escopo.

Transacional não pede opt-in: é sobre um pedido que a pessoa fez. Marketing
pede, e precisa poder ser revogado sem desligar o aviso de "seu pedido saiu
para entrega". Modelar como preferência por `(customer, channel, purpose)`
resolve os dois sem contaminar um com o outro.

Regra dura: nenhuma mensagem de campanha pode reusar um template com
`purpose = transactional`. A separação é do dado, não da boa intenção de quem
escreve a query.

## 9. Templates

Texto **não** mora no evento.

```
event:        PAYMENT_APPROVED
template_key: payment_approved_v1
locale:       pt_BR
variables:    customer_first_name, order_number, amount, payment_method
purpose:      transactional
```

Versionado no nome (`_v1`). Trocar palavra que muda sentido = template novo,
porque provider de WhatsApp aprova template por conteúdo e o aprovado não pode
ser editado por baixo.

Rascunhos (não cadastrar em lugar nenhum ainda):

| Template | Texto |
| --- | --- |
| `order_received_v1` | Olá, {first_name}! Recebemos seu pedido #{order_number} na Persi. Estamos aguardando a confirmação do pagamento. |
| `payment_pending_pix_v1` | Seu pedido #{order_number} foi criado. O pagamento via Pix ainda está pendente. Você pode acompanhar pelo site da Persi. |
| `payment_approved_v1` | Pagamento aprovado! Seu pedido #{order_number} foi confirmado e seguirá para preparação. |
| `order_ready_for_pickup_v1` | Seu pedido #{order_number} está pronto para retirada na Persi. |
| `order_shipped_v1` | Seu pedido #{order_number} foi enviado. Acompanhe a entrega pelo link de rastreamento da Persi. |
| `order_delivered_v1` | Seu pedido #{order_number} foi entregue. Obrigado por comprar com a Persi! |

Variável que falta em tempo de render é falha **permanente** de conteúdo, não
transitória: não adianta tentar de novo daqui a uma hora.

## 10. Adapter de provider

Nenhum provedor escolhido. O domínio conhece o contrato, não o endpoint.

```
interface WhatsAppProvider {
  sendTemplate(...): Promise<{ providerMessageId, providerStatus }>;
  getMessageStatus(...): Promise<{ providerStatus }>;
  verifyWebhook(...): boolean;
  parseWebhook(...): NormalizedDeliveryEvent[];
}
```

Candidatos possíveis: Meta WhatsApp Cloud API, BSP autorizado. A escolha muda
limites de template, janela de 24h e granularidade de status — por isso a
decisão vem **antes** de escrever o adapter, não depois.

Nada de `fetch("https://graph.facebook.com/...")` fora do adapter.

**E-mail** entra como segundo canal do mesmo `notification_intents`, com
`notification_deliveries` própria. Nenhum provider de e-mail nesta rodada.

## 11. Webhook de status

**Não criar a rota agora.** Sem provedor escolhido, um `/api/webhooks/whatsapp`
seria um endpoint público sem verificação de assinatura real — superfície de
ataque em troca de nada.

Contrato para quando existir:

1. verificação de assinatura com raw body (o parser JSON do Next.js precisa ser
   desligado nessa rota, como já é feito nos webhooks de pagamento);
2. dedupe por id de evento do provider — mesma regra de `webhook_events`;
3. ACK rápido, processamento assíncrono;
4. `persi_worker` escreve, nunca a sessão do navegador;
5. status do provider normalizado na borda.

## 12. Rastreio

`ORDER_SHIPPED` aponta para **página da Persi**, não para o Melhor Envio.

```
carrier/Melhor Envio → shipment_events → página de rastreio da Persi → link no WhatsApp
```

O link carrega identificador opaco do pedido. **Token de transportadora nunca
entra em URL de cliente** — e o `shipping_provider_credentials` existe
justamente para esse token não circular.

## 13. Olist

Olist **não** chama WhatsApp. Native Commerce continua sendo a orquestração:

```
payment paid → order confirmed → outbox → Olist (fulfillment)
Olist status → evento normalizado → outbox → notification intent → WhatsApp
```

Coerente com a matriz de autoridade de `07-olist-integration.md`: durante a
migração, Persi só vira autoridade depois do cutover de cada domínio.

## 14. Privacidade

Nunca em log: telefone completo, nome completo, endereço, CPF, e-mail, itens do
pedido.

No log vai: `delivery_id`, `intent_id`, `order_id`, `event_type`,
`template_key`, `status`, `attempt_count`, `last_error_code`, correlation id.

No banco: telefone normalizado apenas onde o envio precisa dele, e
`payload_hash` em vez do payload do provider — o mesmo que `integration_inbox`
já faz.

Admin mostra tipo, canal, status, data/hora e tentativas. Não mostra token,
segredo de provider nem payload.

## 15. Worker e autoridade

- worker roda como `persi_worker`, nunca com autoridade de navegador;
- claim: `update ... set status='processing', locked_at=now(), locked_by=$1
  where id in (select id ... for update skip locked)` — mesmo padrão já
  decidido em `06-orders-payments.md`;
- lease com expiração: worker que morre não deixa linha travada para sempre;
- `persi_app` **não** recebe grant de update em notification: a aplicação cria
  intenção dentro do caso de uso, quem entrega é o worker;
- RLS ligada nas tabelas novas, com policies por role, no formato de
  `20260901120000_shipping_core.sql`.

## 16. Cenários de falha

| Cenário | Comportamento exigido |
| --- | --- |
| WhatsApp fora do ar | pedido confirma e paga normalmente; deliveries acumulam em `retry` |
| webhook de pagamento duplicado | uma intent (unique), zero mensagens extras |
| worker reinicia no meio do envio | lease expira, outro worker reassume a MESMA delivery |
| dois workers simultâneos | `skip locked` garante um só; unique garante o resto |
| provider aceita e dá timeout | chave de idempotência evita duplicata; sem ela, não reenviar |
| telefone inválido | `dead_letter` + `invalid_destination`; pedido intacto |
| template rejeitado | `dead_letter` + alerta; é bug de conteúdo |
| outbox atrasado | mensagem atrasa; nada no comércio bloqueia |

O invariante que amarra todos: **nenhum caminho de notificação pode fazer
rollback, bloquear ou atrasar uma transação comercial.** Se um dia isso exigir
escolher, o comércio ganha e a mensagem se perde.

## 17. Plano de implantação

| Fase | Pré-requisito | Entrega |
| --- | --- | --- |
| 0 | — | este documento |
| 1 | `orders`, `payments`, `outbox_events` criados | migration de `notification_intents` + `notification_deliveries`, RLS, grants, pgTAP |
| 2 | fase 1 | normalização de telefone + registry de templates + contrato de provider, com testes, **sem provider** |
| 3 | provedor escolhido e aprovado | adapter, credenciais, templates cadastrados, webhook de status |
| 4 | fase 3 em staging | `PAYMENT_APPROVED` sozinho, canary, com o caminho do painel ainda ligado |
| 5 | fase 4 estável | demais eventos; aposentadoria do `avisarPedido` do painel |

A fase 1 não pode começar antes de `orders` existir. É essa a dependência que
esta rodada encontrou e que nenhum atalho remove.

## 18. Decisões humanas pendentes

1. **Provedor**: Meta Cloud API direto ou BSP? Muda custo, limites e prazo de
   aprovação de template.
2. **Timeout ambíguo**: reenviar (risco de duplicata) ou não reenviar (risco de
   silêncio)? Depende da resposta 1.
3. **`ORDER_READY_FOR_PICKUP`**: existe operação de retirada com estado próprio?
   Hoje não há no domínio.
4. **Janela de 24h do WhatsApp**: aviso transacional fora da janela exige
   template aprovado; confirmar quais dos seis rascunhos precisam de aprovação.
5. **Aposentadoria do caminho do painel**: em que evento o nativo assume e o
   `avisarPedido` sai.
