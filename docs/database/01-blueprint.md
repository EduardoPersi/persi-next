# Persi Database V1 — blueprint arquitetural

## Objetivo e limites

Construir um monólito modular sobre PostgreSQL/Supabase, em paralelo ao
WooCommerce. Nesta fase o documento fecha o desenho; não autoriza migrations,
dual write, shadow reads ou cutover. Até autorização posterior, WooCommerce é a
fonte oficial e o usuário sempre recebe a resposta atual.

```text
Browser -> Next.js (Storefront/BFF) -> Application/Domain -> DAL -> PostgreSQL
                         |                               |
                         +------ adaptadores atuais ----+-> Woo/Inter/PagBank/Frete
```

O browser não acessa tabelas transacionais. Componentes React não conhecem SQL,
credenciais nem contratos de providers. Cada domínio expõe casos de uso e portas;
adaptadores Woo e PostgreSQL podem coexistir durante a migração.

## Decisões fechadas

| Tema | Decisão V1 |
| --- | --- |
| IDs | UUID interno gerado no banco; IDs externos em `external_mappings`; números humanos separados |
| Dinheiro | `bigint` em minor units, moeda ISO 4217 explícita; nunca float |
| Produto | Todo item vendável, inclusive simples, possui exatamente uma variant vendável |
| Preço/estoque/SKU/GTIN | Pertencem à variant; produto é conceito comercial |
| PIM | Atributos tipados e valores normalizados; medidas compostas preservam display e componentes racionais |
| Estoque | `available = on_hand - reserved`; transação + lock/atomic update por variant/location |
| Pedidos | Cabeçalho, itens, endereços e frete guardam snapshots históricos |
| Status | Order, payment e fulfillment são máquinas independentes |
| Pagamento | Provider-neutral; Inter/PagBank ficam em adaptadores e referências externas |
| Idempotência | Chave única por `scope + key`, hash do request e recurso resultante |
| Webhooks | Inbox durável e deduplicável; processamento assíncrono/retry-safe |
| Eventos | Transactional outbox na mesma transação da mudança de domínio |
| Olist | Sem sincronização circular; autoridade por campo definida em `07-olist-integration.md` |
| DAL | Drizzle + driver PostgreSQL; migrations SQL do Supabase CLI, conforme ADR 001 |
| Conexões | runtime pooled conforme topologia; migrations/backup por conexão direta |
| RLS | defense in depth; tabelas sensíveis não expostas ao browser |
| Busca | PostgreSQL FTS + `unaccent` + `pg_trgm`; sem Elasticsearch na V1 |
| Observabilidade | correlation ID, jobs/inbox/outbox auditáveis e logs com redaction |

## Fronteiras de domínio

### Catalog

- Responsabilidade: identidade comercial, publicação, marcas, categorias e mídia.
- Possui: `products`, `product_variants`, `brands`, `categories`, associações e mídia.
- Não possui: preço, estoque, SEO, pedido ou atributos técnicos.
- Depende de: PIM para enriquecimento; SEO/Search como projeções consumidoras.
- Invariantes: slug público único no tipo; produto ativo tem ao menos uma variant
  ativa; SKU não existe em `products`.

### PIM

- Responsabilidade: atributos, unidades, valores, medidas e apresentação técnica.
- Possui: definições, opções, atribuições e componentes de medida.
- Não possui: produto conceitual, preço ou saldo.
- Depende de: IDs de Catalog; pode receber candidatos de Integrations.
- Invariantes: tipo da definição governa o valor; display original é preservado;
  frações usam numerador/denominador inteiros.

### Pricing

- Responsabilidade: preços por variant/lista, vigência e histórico.
- Possui: `price_lists`, `prices`, `price_history`.
- Não possui: promoções calculadas, pedido histórico ou cobrança.
- Depende de: Catalog e, futuramente, Promotions.
- Invariantes: minor units não negativas; uma moeda por lista; vigências não se
  sobrepõem para a mesma variant/lista/prioridade.

### Inventory

- Responsabilidade: saldo físico, reserva e razão de movimentos.
- Possui: locations, levels, movements e reservations.
- Não possui: carrinho, pedido ou prazo de frete.
- Depende de: variant; referencia pedidos/jobs sem tomar ownership.
- Invariantes: `reserved >= 0`, `on_hand >= 0` na política V1 e
  `reserved <= on_hand`; toda mutação gera movimento idempotente.

### Customers

- Responsabilidade: perfil mínimo e endereços reutilizáveis.
- Possui: customers e customer_addresses.
- Não possui: credenciais, sessão, snapshot de pedido ou autorização.
- Depende de: Identity para principal; Orders somente referencia customer.
- Invariantes: e-mail normalizado único quando presente; documento normalizado
  protegido e nunca logado.

### Identity / Authorization

- Responsabilidade: mapear principal autenticado, papéis e permissões.
- Possui futuramente: identities, roles, permissions e assignments, se a
  autenticação aprovada exigir.
- Não possui: perfil comercial ou pedido.
- Dependência atual: WordPress/JWT permanece autoridade; Supabase Auth não é
  presumido.
- Invariantes: vínculo externo único; autorização sempre no servidor.

### Cart

- Responsabilidade: intenção temporária de compra e itens selecionados.
- Possui: carts e cart_items.
- Não possui: preço autoritativo permanente, reserva implícita ou pedido.
- Depende de: Pricing, Inventory, Promotions e Shipping para recálculo.
- Invariantes: quantidade positiva; guest token armazenado somente como hash;
  totais do browser nunca são aceitos como verdade.

### Checkout

- Responsabilidade: orquestrar validação, reserva, pedido e início do pagamento.
- Possui: casos de uso e idempotência; não exige tabela própria V1.
- Não possui: catálogo, saldo ou transação do PSP.
- Depende de: Cart, Inventory, Orders, Payments, Shipping e Customers.
- Invariantes: retry devolve o mesmo resultado; uma tentativa não gera dois
  pedidos/cobranças. O fluxo Woo atual segue intacto até write cutover.

### Orders

- Responsabilidade: registro histórico da venda e seus estados.
- Possui: orders, items, addresses e status history.
- Não possui: cadastro mutável do produto/cliente nem transação PSP.
- Depende de: Customers opcionalmente; recebe snapshots dos demais domínios.
- Invariantes: totais fecham em minor units; snapshots não são atualizados por
  mudanças no catálogo; número público é único e não é PK.

### Payments

- Responsabilidade: intenção financeira e movimentos do provider.
- Possui: payments, transactions, idempotency keys e webhook inbox.
- Não possui: cartão bruto, CVV ou lógica específica espalhada no domínio.
- Depende de: Orders; adaptadores Inter/PagBank.
- Invariantes: valores não negativos; captura/reembolso não excedem limites;
  provider reference é única quando confiável.

### Shipping

- Responsabilidade: catálogo de métodos e execução/snapshot de remessas.
- Possui: shipping_methods, shipments, shipment_events.
- Não possui: endereço editável do cliente nem regra de estoque.
- Depende de: Orders e providers de frete.
- Invariantes: remessa não excede quantidades do pedido; histórico é append-only.

### Promotions

- Responsabilidade: definição promocional, cupons e resgates.
- Possui: promotions, coupons, coupon_redemptions.
- Não possui: total histórico do pedido, que é snapshot.
- Depende de: Catalog/Customers para elegibilidade e Orders para consumo.
- Invariantes: limites e validade são atômicos; código normalizado é único.

### SEO

- Responsabilidade: metadata e redirects sem alterar rotas existentes.
- Possui: seo_metadata e redirects.
- Não possui: slug canônico das entidades.
- Depende de: Catalog; referências polimórficas são controladas por
  `entity_type + entity_id` e validação de serviço.
- Invariantes: uma metadata por entidade/locale; redirect source único e sem loop.

### Search

- Responsabilidade: documento de busca derivado, sinônimos e ranking.
- Possui: search_synonyms e futura projeção/materialized view, não fonte de dados.
- Não possui: conteúdo canônico.
- Depende de: Catalog, PIM, Pricing e Inventory.
- Invariantes: falha de indexação não altera catálogo; reconstrução é possível.

### ERP / Integrations

- Responsabilidade: mappings, jobs, erros, inbox/outbox e reconciliação.
- Possui: external_mappings, integration_jobs, integration_errors e outbox.
- Não possui: entidades comerciais canônicas.
- Depende de: todos os domínios via IDs/contratos estáveis.
- Invariantes: mapping externo único por sistema/tipo/ID; jobs retry-safe.

### Audit

- Responsabilidade: trilha administrativa e de operações críticas.
- Possui: audit_logs imutáveis com metadata sanitizada.
- Não possui: payloads secretos ou PII desnecessária.
- Depende de: Identity para actor e correlation ID.
- Invariantes: append-only; timestamps UTC; falha de auditoria crítica aborta a
  operação administrativa quando exigido pela política.

## Dependências permitidas

Dependências apontam para contratos/casos de uso, nunca para tabelas de outro
domínio diretamente em componentes. Catalog é referenciado por IDs; Pricing e
Inventory não se chamam mutuamente. Checkout é o orquestrador. Orders e Audit
consomem snapshots/eventos. Integrations depende de portas de aplicação, não do
interior dos domínios.

## Conflitos com o sistema atual

- WordPress continua sendo Identity/Customers: criar tabelas futuras não muda a
  autoridade antes do cutover.
- Woo mantém carrinho e frete por `Cart-Token`: carts PostgreSQL só entram após
  validação paralela e plano de migração de sessão.
- A idempotência atual vive no plugin Woo: o futuro PostgreSQL deverá importar
  ou mapear tentativas antes de assumir writes.
- O plugin Olist/PIM local não rastreado inspira regras, mas não é dependência da
  plataforma nova.

## Sequência de implementação sugerida

1. Core/extensions, tipos controlados e funções comuns.
2. Catalog e PIM.
3. Pricing e Inventory.
4. Customers, Cart, Orders, Payments, Shipping e Promotions.
5. SEO/Search, Integrations, inbox/outbox, Audit e RLS.
6. Import staging, reconciliação e shadow reads.

Cada grupo deve ser uma migration Supabase pequena, transacional quando
possível, reproduzível em banco vazio e acompanhado de testes de constraints.

## Gates de decisão humana

O design técnico está fechado; estes parâmetros de negócio/ambiente precisam de
aprovação antes da parte correspondente da Fase C ou de qualquer cutover:

- aprovação da dependência Drizzle/driver e Node LTS do runtime;
- topologia real Hostinger e modo de pooler/plano Supabase disponível;
- Olist como autoridade de saldo físico e mapeamento de locations;
- política de reserva/expiração por Pix, boleto e cartão;
- captura/parcelamento/refund e tratamento de pagamento tardio;
- sequência/formato do `order_number` e obrigações fiscal/retention;
- catálogo inicial de roles/permissões administrativas;
- RPO/RTO contratados e custo de PITR/export independente;
- versionar ou descartar formalmente o plugin Olist/PIM não rastreado.

Esses gates não deixam o schema indefinido: defaults seguros estão documentados,
mas não podem decidir políticas comerciais ou contratar infraestrutura em nome
da empresa.
