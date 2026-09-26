# Integração Olist ERP — Native Commerce (design, não implementado)

Status: **design only, not implemented**. Nenhuma migration, nenhum código em
`lib/`, `services/` ou `app/`, nenhuma chamada à API do Olist, nenhum acesso a
staging/produção. Este documento responde ao pedido "Olist é a fonte da
verdade de produto/preço/estoque" e complementa dois documentos já
existentes, que **não são re-derivados aqui**:

- [`docs/database/07-olist-integration.md`](../database/07-olist-integration.md)
  — matriz de autoridade e direções gerais (catálogo, GTIN, estoque, pedido,
  pagamento). Ponto em aberto que este documento **fecha**: "confirmar se
  Olist será autoridade de `on_hand` por local" — ver Seção 5.
- [`docs/database/82-olist-native-integration-design.md`](../database/82-olist-native-integration-design.md)
  ("Track F") — design **completo** do outbox de exportação de pedido
  site→Olist (DDL de `integration_outbox`/`integration_errors`, ponto atômico
  de enfileiramento, duas camadas de idempotência, backoff, reconciliação).
  Este documento **reaproveita 82 integralmente** para a direção site→Olist
  (Seção 7) e foca o esforço novo na direção Olist→site (catálogo/preço/
  estoque), que 82 explicitamente deixa fora do seu escopo.

## 1. Decisão e fato novo confirmado pelo dono

Modelo aprovado (2026-09-23):

- **Olist → site**: catálogo, preço e estoque (webhook/notificação +
  reconciliação periódica).
- **Site → Olist**: somente pedido **pago**, idempotente, via outbox. O
  Olist baixa o próprio estoque; o site nunca escreve estoque no Olist.
- Vendas do PDV físico (loja Olist) chegam ao site pelo mesmo sync de
  estoque — não precisam de tratamento especial (Seção 5).
- `estoque disponível no site = saldo Olist − reservas nativas ativas −
  margem de segurança`.

**Fato confirmado pelo dono nesta rodada, que muda a Seção 8 (convivência
com Woo) e a prioridade das Seções 5 e 7**: o Olist **já sincroniza**
produto/preço/estoque para o WooCommerce e **já recebe** os pedidos feitos
no Woo, via integração oficial Olist↔WooCommerce. Consequências diretas:

1. Os preços/estoques nativos hoje no staging são um **snapshot vindo do
   Woo** (via `integration_inbox`/`external_mappings system='woocommerce'`)
   e ficam desatualizados em relação ao Olist em tempo real — o sync
   Olist→site direto (Seção 5) é **bloqueador do canário**, junto com a
   exportação de pedido site→Olist (Seção 7). Sem os dois, o native
   commerce venderia com preço/estoque potencialmente errados e pedidos
   pagos nunca chegariam ao Olist para separação/fatura.
2. A integração Olist↔Woo existente **não deve ser alterada nem
   desligada** — convive até o fim da transição (Seção 8).
3. **Chave de ligação**: se o SKU/código do Olist é o mesmo gravado no
   campo SKU do Woo (plausível, já que é o próprio Olist quem popula esse
   campo via sua integração com o Woo), o mapeamento Olist↔nativo pode ser
   **derivado** do mapeamento Woo↔nativo já existente e já validado 100%
   1:1 (Gate 3 Passo 2: 3.080 produtos, zero duplicados, zero órfãos) — ver
   Seção 4.

## 2. API pesquisada — Olist ERP = Tiny ERP v3

Confirmado por duas fontes independentes: (a) pesquisa pública nesta rodada
e (b) o plugin WordPress não versionado `wordpress-plugin/persi-catalog-engine`
já existente no ambiente local, que já usa essa mesma API para GTIN/catálogo
(`src/Api/Configuration.php:8-9`, `docs/architecture.md:10-14`).

**"Olist ERP" é o antigo Tiny ERP** (Olist adquiriu a Tiny); a documentação
oficial hoje vive em `api-docs.erp.olist.com` e `ajuda.olist.com`, mas os
webhooks detalhados ainda estão publicados sob `tiny.com.br/api-docs` — os
dois domínios descrevem o mesmo produto/API. Existem duas versões:

- **API v2** — legada, continua funcional, sem novos recursos.
- **API v3** — atual, 100% JSON/REST (GET/POST/PUT/DELETE), autenticação
  OAuth2 (`client_id`/`client_secret` gerados no módulo "Aplicativos" da
  conta Olist). Base confirmada pelo plugin local:
  `https://api.tiny.com.br/public-api/v3`; token endpoint
  `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token`.

Fontes: [Central de Ajuda — Aplicativos API V3](https://ajuda.olist.com/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao) ·
[Olist ERP API v3 reference index](https://api-docs.erp.olist.com/llms.txt) ·
[Webhooks Tiny API 2.0](https://tiny.com.br/api-docs/api2-webhooks) ·
[Reserva de Estoque](https://ajuda.olist.com/gestao-de-estoque/reserva-de-estoque) ·
[Versão 3.1.2 — changelog](https://api-docs.erp.olist.com/changelog/versao-3-1-2).

### 2.1 Endpoints relevantes confirmados (v3)

| Área | Endpoints confirmados |
| --- | --- |
| Produtos | CRUD completo; variações; kit; atualizar preço do produto/variação; anexos/imagens; tags; custos |
| Listas de preço | CRUD completo (criar/obter/atualizar/listar lista, excluir produto da lista) |
| Estoque/depósitos | obter/atualizar estoque de um produto; listar depósitos; listar logs de movimentação de estoque |
| Pedidos de venda | CRUD completo; atualizar situação; **lançar estoque do pedido**; **estornar estoque do pedido**; gerar nota fiscal |
| Notas fiscais | listar/obter/autorizar/cancelar; XML/DANFE; lançar/estornar estoque da NF |

### 2.2 Webhooks confirmados

**Decisão do dono, 2026-09-25 (Seção 14.6): nenhum destes webhooks é
cadastrado no painel Olist na Fase 1.** Enquanto o suporte Olist não
confirmar que múltiplos webhooks por tipo/conta são possíveis sem
sobrescrever a integração oficial Olist↔Woo, a Fase 1 usa **polling**
(Seção 5.2/7.2) como estratégia primária. Esta seção fica mantida como
referência técnica confirmada, para quando o webhook virar otimização
futura (Seção 14.6) — não descreve o que a Fase 1 implementa.

| Webhook | Payload (campos confirmados) |
| --- | --- |
| Atualização de Estoque | `dados.idProduto`, `dados.sku`, `dados.skuMapeamento`, `dados.saldo`, `dados.tipoEstoque` (`F`=físico, `D`=disponível) |
| Envio de Preço de Produtos | `dados.idMapeamento`, `dados.skuMapeamento`, `dados.preco`, `dados.precoPromocional` |
| Atualização de Situação de Pedido | `dados.idPedidoEcommerce`, `dados.idVendaTiny`, `dados.situacao`, `dados.descricaoSituacao` |
| Envio de Produtos, Envio de Nota Fiscal, Envio de Código de Rastreio, Cotação de Fretes | existem, payload não detalhado nesta pesquisa (não necessários para a Fase 1) |

Confirmado: um retorno diferente de HTTP 200 faz o Olist **reenviar** o
webhook. **Contagem de tentativas/backoff, confirmado nesta rodada**
([Webhooks — Atualização de Situação de Pedido](https://tiny.com.br/api-docs/api2-webhooks-atualizacao-situacao-pedido)):
**Estoque e Situação de Pedido**: até **15 tentativas**, atraso progressivo
de **+5 minutos a cada tentativa**. **Produto, Nota Fiscal e Preço**: só
**2 tentativas** — bem mais frágil, ver Seção 14.5 (reconciliação de preço
obrigatória por causa disso). Decimais usam `.` como separador.

### 2.3 Campo de referência externa / idempotência no pedido

**Estrutura exata confirmada nesta rodada**
([Criar pedido — Olist ERP API v3](https://api-docs.erp.olist.com/api-reference/pedidos/criar-pedido)):
`numeroPedidoEcommerce` **não é um campo plano** — vive dentro de um objeto
`ecommerce` no corpo da requisição: `ecommerce: { id, numeroPedidoEcommerce
}`. `id` (inteiro, nullable) é o identificador do **canal/integração
e-commerce** que originou o pedido — a mesma peça que aparece como
`dados.idEcommerce` no payload de webhook (Seção 2.2) e como
`ecommerce.id`/`ecommerce.canalVenda` na resposta de `GET /pedidos`
(também confirmado nesta rodada, com o filtro
**`numeroPedidoEcommerce`** disponível diretamente em `GET /pedidos`, ao
lado de `situacao`, `dataInicial`/`dataFinal`, `dataAtualizacao`, `cpfCnpj`,
entre outros). **Isto responde a pergunta da Seção 14.7** sobre indicar o
canal na criação do pedido — ver aquela seção para a decisão completa.
`numeroPedidoEcommerce` continua sendo o campo natural para carregar o
`orders.id`/`order_number` do Persi.

**Confirmado pelo suporte Olist em 2026-09-25 (fecha o que antes era
`A CONFIRMAR_OLIST`): o Olist NÃO bloqueia nem deduplica um pedido repetido
com o mesmo `numeroPedidoEcommerce`** — enviar duas vezes cria dois pedidos
reais. Consequência direta para 82 §7 (Camada 2 de idempotência): antes de
**qualquer** (re)envio — inclusive depois de um timeout ou erro ambíguo —
o adapter deve primeiro consultar `GET /pedidos?numeroPedidoEcommerce=...`
e só criar um pedido novo se a consulta não retornar nada. Isto é mais
forte que a checagem original de 82 §7 (que consultava só
`external_mappings`, local): agora a consulta precisa ser feita **contra o
próprio Olist**, porque um pedido pode ter sido criado do lado Olist sem a
escrita local em `external_mappings` ter chegado a confirmar (exatamente o
cenário "ambíguo" que 82 §7 já previa, agora com o mecanismo de resolução
confirmado). Nunca reenviar em timeout sem essa consulta prévia.

Outros campos confirmados no payload de criação de pedido: `consumidorFinal.cpfCnpj`,
`valorFrete`, `valorDesconto` (valor plano — **não há campo de código de
cupom nomeado confirmado**, A CONFIRMAR_OLIST), `itens[].produto.id`,
`itens[].quantidade`, `itens[].valorUnitario`, `situacao` (enum 0–9).

**Valores do enum `situacao`, confirmados nesta rodada**
([Listar pedidos — Olist ERP API v3](https://api-docs.erp.olist.com/api-reference/pedidos/listar-pedidos),
usado como filtro de listagem, mesmo enum do campo do pedido): `0` Aberta,
`1` Faturada, `2` **Cancelada**, `3` Aprovada, `4` Preparando Envio, `5`
Enviada, `6` Entregue, `7` Pronto Envio, `8` Dados Incompletos, `9` Não
Entregue. Isto **fecha** o item que estava em aberto na Seção 12 ("a API de
pedidos aceita cancelamento pós-criação?"): não há um endpoint dedicado
"cancelar pedido" — cancelar é **atualizar `situacao` para `2`**, a mesma
operação de mudança de situação já mapeada nesta seção. Fonte indireta (a
página pública da operação de escrita `alterar situação` não foi
encontrada com o enum documentado) — o valor `2 = Cancelada` vem do enum
usado pelo filtro de leitura, que é a mesma enumeração; tratar como
confirmado com alta confiança, não como 100% oficial até uma chamada real
de teste confirmar.

### 2.4 Quando o pedido baixa o estoque

**CONFIRMADO PELO DONO**: a conta Olist da Persi está configurada para
baixar estoque **na aprovação do pedido** (uma das opções de
"Configurações → Suprimentos → Lançamento de estoque para saídas" —
Seção 2, ver também a ação explícita `lançar estoque do pedido` da API
v3). Consequência direta para o design (Seção 7):

- O export do pedido site→Olist só deve acontecer **depois** do pagamento
  aprovado (exatamente o gatilho que 82/Seção 7 já usa — `pending →
  confirmed`) — nunca antes, e nunca para um pedido ainda `pending`. Isso
  já era o design; agora está confirmado que é também o momento correto
  do ponto de vista do Olist (a baixa de estoque do lado Olist só
  acontece quando o pedido chega lá já aprovado, então exportar mais cedo
  não adiantaria a baixa, só criaria um pedido "pendente" no Olist sem
  necessidade).
- **Entre o pagamento aprovado no site e o pedido efetivamente baixar
  estoque no Olist** (latência de export + processamento do lado Olist),
  quem segura o estoque é a **reserva nativa** (`inventory_reservations`,
  já existente, confirmada por `apply_verified_payment_transition` —
  Seção 3) — ela só é liberada quando o pedido é confirmado/cancelado no
  fluxo nativo, não quando o Olist processa o export. Não há uma janela
  de estoque "sem dono" entre esses dois eventos.

### 2.5 Reserva de estoque nativa do Olist

O próprio Olist já modela **físico / reservado / disponível** (mesmo
conceito de `inventory_levels` do Persi): "Pedido criado: estoque reservado
↑", liberado automaticamente ao cancelar/excluir o pedido. É configurável
enviar o **saldo disponível** (já líquido das reservas do próprio Olist —
que incluem pedidos vindos do Woo e, após a Fase 1, do site) para a
integração. **Isto é a base da fórmula da Seção 5.3** — evita contar a
mesma reserva duas vezes.

### 2.6 Autenticação, limites, sandbox

- OAuth2, `client_id`/`client_secret` por "Aplicativo" (máx. 5 por conta),
  permissões por módulo (leitura/gravação/exclusão).
- Rate limit **por conta**, não por aplicativo (aplicativos da mesma conta
  dividem o limite): 30/30 a 140/100 requisições por minuto
  (leitura/escrita) dependendo do plano contratado. **Confirmado pelo
  suporte Olist em 2026-09-25: plano da Persi é "Impulsione", 60
  requisições/min por conta** (leitura e escrita), compartilhado com a
  integração oficial Olist↔Woo — ver Seção 14.4 para o orçamento
  recalculado com este número real.
- **Nenhum ambiente de sandbox/teste foi encontrado para os "Aplicativos"
  OAuth v3** — testes de integração via v3 precisam ser feitos contra a
  conta real (com cuidado: qualquer escrita cria um produto/pedido real).
  **Achado novo, mecanismo diferente**: a integração legada "Token API"/
  "Ecommerce da Olist" (Menu → Configurações → Aba E-commerce → Token API,
  ou Menu → Início → Loja de extensões) **permite gerar um token separado
  por ambiente, incluindo um ambiente de Staging**, segundo a Central de
  Ajuda ([Gestão Ecommerce - API - Configurações](https://ajuda.olist.com/hubs-e-plataformas-via-api/gestao-ecommerce-api-configuracoes)).
  Isto é uma integração diferente da usada pelos "Aplicativos" OAuth v3
  (Seção 14.7) — não resolve a falta de sandbox para pedidos via v3, e não
  foi adotado neste plano (manteria uma segunda forma de autenticação só
  para um ambiente de teste, complexidade não pedida agora); registrado
  aqui para o dono avaliar depois, se o modo `dry_run` (Seção 14.1) não for
  suficiente.
- Vida útil de token de acesso/refresh: só encontrada em uma fonte
  não-oficial (PR de terceiro no GitHub, access token ~4h / refresh ~1
  dia) — **A CONFIRMAR_OLIST**, não tratar como garantido.

## 3. O que já existe no repositório e será reaproveitado

Levantamento completo feito nesta rodada (sem alterar nada):

- `external_system` (enum Postgres, `lib/db/schema/core.ts:15-17`) **já
  inclui `'olist'`** desde a migration original
  (`supabase/migrations/20260823110000_core.sql:16`) — nenhuma
  `ALTER TYPE` necessária.
- `external_mappings.entity_type` (CHECK constraint, não enum) **já
  permite `'order'`** desde
  `supabase/migrations/20260901120000_shipping_core.sql:20-27` (adicionado
  para `shipments`) — nenhuma migration de constraint necessária para
  mapear pedidos Olist.
- `inventory_movement_type` (enum, `lib/db/schema/core.ts:9-11`) **já
  inclui `'erp_sync'`**, e a função `adjust_inventory`
  (`supabase/migrations/20260823110400_inventory.sql:265-306`) **já tem um
  branch explícito**: `case when p_source_system = 'olist' then 'erp_sync'
  else 'adjustment' end`. Ou seja, a função que vai receber o saldo do
  Olist **já existe e já foi escrita pensando nisso** — falta apenas o
  worker/rota que a chama a partir do webhook, e o `GRANT` (nenhum existe
  hoje para nenhuma role `persi_*`).
- `adjust_inventory` já **recusa** (`23514
  adjustment_below_reserved_inventory`) reduzir `quantity_on_hand` abaixo
  de `quantity_reserved` — isto já é o guard-rail de oversell (Seção 5.4).
- `inventory_movements.source_system`/`source_reference` são `text` livre
  (não o enum `external_system`) com índice único em
  `(source_system, source_reference, movement_type)` — dá deduplicação
  gratuita por evento de webhook (usar o id do evento do webhook, ou
  `idProduto + saldo + timestamp`, como `source_reference`).
- `integration_outbox`/`integration_errors` (direção site→Olist) **não
  existem ainda** — DDL completo já especificado em 82 §9, reaproveitar
  sem alterar.
- Padrão de job periódico já estabelecido:
  `app/api/cron/expire-pending-payments/route.ts` — Route Handler
  `force-dynamic`/`nodejs`, autenticado por
  `Authorization: Bearer <CRON_SECRET>` (`isAuthorizedCronRequest`),
  `overlapGuard` em memória (processo único na Hostinger), orçamento de
  tempo (`TIME_BUDGET_MS`) com `truncated`/`remaining` na resposta,
  disparado por um cron **externo** (Hostinger/cron-job.org) — nenhum
  scheduler roda dentro do app. Um novo job Olist deve seguir exatamente
  esse formato.
- Reconciliação já tem um padrão real para copiar:
  `services/payments/cronReconciliation.ts` +
  `services/payments/reconcile.ts` (relê o estado ao vivo no provedor,
  nunca confia em status pré-computado).

## 4. Mapeamento SKU Olist ↔ variante nativa

Reaproveita `external_mappings` sem nova tabela, igual ao padrão já
existente para `woocommerce`:

```
system:         'olist'
entity_type:    'product' | 'product_variant'   -- mesmos valores já usados para woocommerce
internal_id:    products.id / product_variants.id
external_id:    idProduto do Olist (estável; não usar SKU como external_id, SKU pode ser editado)
external_sku:   sku do Olist (para join/auditoria)
```

**CONFIRMADO PELO DONO**: o SKU do Woo é o mesmo SKU/código do Olist —
portanto o mapeamento `system='olist'` é **derivado diretamente** do
mapeamento `system='woocommerce'` já existente e já validado 100% 1:1
(Gate 3 Passo 2), pelo SKU, sem precisar de nenhuma chamada à API do Olist
para descobrir a correspondência:

```sql
-- Para cada mapping woocommerce com external_sku preenchido e igual ao
-- sku do Olist, a linha olist aponta para o MESMO internal_id:
insert into external_mappings (system, entity_type, internal_id, external_id, external_sku, status)
select 'olist', em.entity_type, em.internal_id, <idProduto do Olist para este SKU>, em.external_sku, 'active'
from external_mappings em
where em.system = 'woocommerce' and em.external_sku is not null;
```

`external_id` ainda precisa do `idProduto` do Olist (Seção 4, "não usar SKU
como `external_id`, SKU pode ser editado") — isso exige uma consulta à API
do Olist (uma vez, em lote, por SKU) para obter o `idProduto`
correspondente a cada SKU; **essa é a única chamada à API do Olist que a
derivação em si precisa**, e é justamente o tipo de chamada que esta rodada
(somente leitura local, sem chamada ao Olist) não está autorizada a fazer.

**Validação por contagem — proposta exata para a próxima rodada com
autorização de leitura em staging/produção** (a fórmula do dono):

1. `SELECT count(*) FROM external_mappings WHERE system='woocommerce' AND
   entity_type='product'` — total de produtos mapeados hoje (Woo).
2. `SELECT count(*) FROM external_mappings WHERE system='woocommerce' AND
   entity_type='product' AND (external_sku IS NULL OR external_sku = '')`
   — SKUs vazios (não derivam automaticamente; ficam de fora até revisão).
3. `SELECT external_sku, count(*) FROM external_mappings WHERE
   system='woocommerce' AND entity_type='product' AND external_sku IS NOT
   NULL GROUP BY external_sku HAVING count(*) > 1` — SKU duplicado no lado
   Woo↔nativo (não deveria existir dado o índice único already `(system,
   entity_type, internal_id)`, mas o SKU em si não tem unicidade
   garantida — dois produtos podem ter o mesmo texto em `external_sku` por
   erro de cadastro; **HARD STOP** se algo aparecer aqui, mesmo critério do
   Gate 3 Passo 2).
4. SKUs do Olist sem par no site: comparar a lista de SKUs retornada pela
   API do Olist (`GET /produtos`, paginado) contra o conjunto de
   `external_sku` do passo 1 — sobras do lado Olist ficam de fora do sync
   até revisão (não é um erro, só um produto Olist que não existe/não está
   publicado no site).
5. SKUs do site sem par no Olist: o inverso do passo 4 — produtos Woo cujo
   `external_sku` não aparece na resposta do Olist; ficam sem sync de
   estoque/preço direto até resolução manual (continuam recebendo dado só
   pelo caminho atual, Woo).

**Casos especiais**:

- **SKU sem par** (existe no Woo, não existe/não é encontrado no Olist, ou
  vice-versa): não mapear — produto fica de fora do sync direto e continua
  recebendo preço/estoque só via o caminho atual (Woo), até revisão manual.
  Consistente com "estoque disponível deve falhar fechado" já usado no
  Gate 3 (`resolveNativeVariantByWooProductId` já retorna `null` para
  produto sem mapeamento).
- **SKU duplicado** (mesmo SKU em dois produtos Olist, ou um SKU Olist
  batendo com dois produtos nativos): **HARD STOP** antes de aplicar
  qualquer sync — mesmo critério já usado no Gate 3 Passo 2 ("se
  duplicados forem encontrados, parar e reportar antes de prosseguir").
  `external_mappings_external_unique (system, entity_type, external_id)`
  já impede fisicamente duas linhas `olist` apontando o mesmo `idProduto`
  para produtos internos diferentes — uma tentativa de inserir a segunda
  falha na constraint, então isso é visível como erro, não como corrupção
  silenciosa.
- **Kit/composição** (endpoint "produto kit" do Olist): **CONFIRMADO PELO
  DONO** — kits têm SKU próprio e são tratados como produto comum para
  fins de mapeamento (Seção 4 se aplica sem alteração: mesma derivação por
  SKU, mesma linha `external_mappings`). O **estoque do kit é o que o
  próprio Olist calcula** (não é recalculado pelo site) — o site só grava
  o saldo que o webhook/reconciliação do kit devolve, exatamente como para
  qualquer outro SKU (Seção 5). Consequência a documentar operacionalmente
  (não é um caso especial de código, é um comportamento a explicar para
  quem opera): **a venda de um componente avulso reduz o estoque calculado
  do kit** — se o componente vender (no site, no Woo ou no PDV físico) e
  isso reduzir a disponibilidade do kit no Olist, o próximo evento de sync
  (webhook ou reconciliação) já traz o saldo do kit correto; não há uma
  ação separada do site para isso, mas o runbook (Seção 10) deve mencionar
  esse comportamento para não ser confundido com uma divergência de sync.

## 5. Sync Olist → site (catálogo, preço, estoque)

### 5.1 Carga inicial

Um script único (fora do build, no padrão `scripts/database/*-disposable.mjs`
já usado neste projeto), rodando **depois** da derivação de mapeamento
(Seção 4): para cada `external_mappings (system='olist')`, consulta
"obter estoque de um produto" e "obter lista de preços" e grava via
`adjust_inventory(..., p_source_system='olist', ...)` e uma escrita
equivalente em `prices`/`price_lists` (ver 5.4 sobre preço). Roda uma vez,
manualmente disparado, com relatório de quantos produtos foram carregados/
falharam — não é um cron.

### 5.2 Polling incremental — estratégia primária da Fase 1 (2026-09-25)

**Decisão do dono (Seção 14.6): a Fase 1 não usa webhook.** Nenhuma URL de
webhook deste projeto é cadastrada no painel Olist enquanto o suporte não
confirmar que isso não sobrescreve a integração oficial Olist↔Woo. A
estratégia primária passa a ser **polling** — o mesmo job cron (padrão
`expire-pending-payments`, Seção 3) que fazia só reconciliação (antiga
Seção 5.3, incorporada aqui) agora é a **única** via de sync de
catálogo/preço/estoque na Fase 1. A Seção 5.5 abaixo mantém o desenho de
webhook como referência para quando virar otimização futura.

**Duas cadências, preço mais frequente que estoque** — porque o SLA de
correção depende de quanto custa um dado desatualizado em cada caso: um
preço errado no site é visível ao cliente imediatamente (risco comercial/
jurídico, ex. Lei do Desconto); um estoque levemente atrasado é absorvido
pela reserva nativa (`inventory_reservations`) e pelo guard-rail de
`adjust_inventory` (Seção 6.2) até o próximo ciclo. Frequência exata de
cada cadência **depende do plano confirmado (Seção 14.4)** — a estrutura
abaixo já pode ser fixada.

**Filtro incremental — o que a API v3 realmente suporta, confirmado nesta
rodada** ([Listar produtos — Olist ERP API v3](https://api-docs.erp.olist.com/api-reference/produtos/listar-produtos)):
`GET /produtos` aceita `dataAlteracao` (data de última alteração do
produto) como filtro, além de `situacao`, `codigo`, `gtin`, `limit`/`offset`
paginados (100/página). Isto cobre metadados de catálogo (nome, situação,
GTIN) de forma incremental de verdade — só produtos alterados desde o
último ciclo.

**O que NÃO foi confirmado publicamente** (importante para não prometer
mais do que existe): nenhum endpoint v3 de **saldo de estoque por produto**
com filtro de data foi encontrado — "obter estoque de um produto" (Seção
2.1) é por SKU/id individual, sem paginação em lote nem `dataAlteracao`. Um
endpoint incremental de estoque existe, mas é da **API v2 legada**
(`POST lista.atualizacoes.estoque`, autenticação por `token` estático, não
OAuth2 v3 — [Lista de Atualizações de Estoque](https://api-docs.erp.olist.com/api-v2/produtos/atualizacoes-estoque)),
o que exigiria uma segunda forma de autenticação só para esse endpoint —
**decisão de implementação, não resolvida aqui**: usar o endpoint v2
incremental (menos chamadas, mais complexidade de auth) ou fazer varredura
completa em rodízio via o endpoint v3 por SKU (mais chamadas, uma única
credencial OAuth2). A Seção 14.4 abaixo orça pelo caminho mais simples
(varredura v3 por SKU) como baseline conservador; trocar pelo endpoint v2
é uma otimização a avaliar depois, não um bloqueador da Fase 1.

De forma equivalente, **nenhum endpoint v3 de listagem de preços com
filtro de data** foi encontrado nesta rodada (só `POST`/`PUT`/`DELETE` de
listas de preço, changelog 3.1.1 — nenhum `GET` paginado confirmado); a
Seção 14.4 também orça preço pelo caminho conservador (uma chamada por SKU
via "obter lista de preços" por produto), sinalizando que, se um `GET` em
lote existir e for confirmado na implementação, o custo real seria bem
menor.

**Mecânica do polling** (aplica-se a estoque e preço, cada um na sua
cadência):

1. Cron lê uma fatia de `external_mappings (system='olist')` por ciclo
   (rodízio por cursor, não por offset — mesmo motivo já usado no restante
   do projeto: não pular itens se o conjunto mudar entre ciclos).
2. Para cada item da fatia, consulta a API do Olist (estoque ou preço,
   conforme a cadência do job) e grava o valor lido via `adjust_inventory`/
   `apply_olist_price_sync` (Seção 2.2.3 do plano de implementação),
   `p_source_system='olist'`, usando `idProduto + valor lido + timestamp da
   consulta` como `source_reference`/`source_event_id` para deduplicar.
3. Nenhuma comparação de "divergência" é necessária como conceito
   separado — o polling sempre grava o valor mais recente que a própria API
   confirmou; o guard-rail de oversell (Seção 6.2, erro `23514`) continua
   sendo a única defesa estrutural quando o saldo lido for menor que o
   reservado.
4. Loga uma métrica de cobertura (quantos SKUs foram varridos, quanto
   tempo desde a última leitura de cada um) — permite detectar se o rate
   limit real está insuficiente para a cadência desejada (Seção 14.4)
   antes que isso vire um problema de estoque/preço desatualizado.

### 5.3 (reservado — conteúdo incorporado à Seção 5.2)

### 5.4 Preço

**CONFIRMADO PELO DONO**: existe **uma única lista de preço** — o site usa
o mesmo preço da loja física. Isso simplifica a gravação: o polling de
preço (Seção 5.2) alimenta sempre a mesma `price_lists` do site
(`prices.source = 'olist'`, mecanismo de gravação já trivial dado o schema
agnóstico de fonte — `lib/db/schema/pricing.ts`), sem precisar de nenhuma
lógica de "qual lista corresponde a qual preço" — não há ambiguidade a
resolver. `precoPromocional`, quando presente, mapeia para
`prices.sale_amount_minor` (com `sale_valid_from`/`sale_valid_to` — **A
CONFIRMAR_OLIST** se a resposta também informa a validade da promoção ou só
o valor).

### 5.5 Webhook — fase futura, não Fase 1 (Seção 14.6)

Conteúdo técnico já desenhado e confirmado (Seção 2.2, Seção 14.2 — regra
de "webhook nunca é autoridade, só gatilho de re-query" continua válida
para quando isto for implementado): três rotas
`app/api/webhooks/olist/{estoque,preco,situacao-pedido}/route.ts`,
autenticadas por segredo próprio do site (`OLIST_WEBHOOK_SECRET`), que
resolvem o mapeamento e disparam um re-query síncrono à API — nunca gravam
o valor do payload diretamente. **Não implementado nesta fase.** Só
avaliado depois que o suporte Olist confirmar que cadastrar essas URLs não
substitui a notificação já usada pela integração oficial Olist↔Woo (Seção
14.6).

### 5.4 Preço

**CONFIRMADO PELO DONO**: existe **uma única lista de preço** — o site usa
o mesmo preço da loja física. Isso simplifica a gravação: o webhook de
preço (`Envio de Preço de Produtos`, `preco`/`precoPromocional` por
produto) alimenta sempre a mesma `price_lists` do site (`prices.source =
'olist'`, mecanismo de gravação já trivial dado o schema agnóstico de
fonte — `lib/db/schema/pricing.ts`), sem precisar de nenhuma lógica de
"qual lista corresponde a qual preço" — não há ambiguidade a resolver.
`precoPromocional`, quando presente, mapeia para `prices.sale_amount_minor`
(com `sale_valid_from`/`sale_valid_to` — **A CONFIRMAR_OLIST** se o
webhook também informa a validade da promoção ou só o valor).

## 6. Estoque disponível, margem de segurança e oversell

Fórmula aprovada pelo dono, mapeada para o schema real (`inventory_levels`,
`lib/db/schema/inventory.ts:15-28`):

```
quantity_on_hand      = saldo "D" (disponível) recebido do Olist via 5.2/5.3
                         (já líquido das reservas do PRÓPRIO Olist — Seção 2.5)
quantity_reserved     = reservas nativas ativas do Persi (inventory_reservations,
                         já existe e já é usado por prepare_native_checkout)
quantity_available    = quantity_on_hand - quantity_reserved
                         (coluna gerada, já existe, sem margem — Seção 6.1)
estoque_ofertado_site = quantity_available - margem_de_segurança
                         (calculado em leitura, NÃO gravado — Seção 6.1)
```

### 6.1 Onde aplicar a margem de segurança

**CONFIRMADO PELO DONO: margem de segurança = 0** (não zero "por
enquanto" — é a política aprovada). `estoque_ofertado_site` portanto é
hoje literalmente igual a `quantity_available`, sem nenhum desconto
adicional. Mantém-se ainda assim a recomendação de **não alterar a coluna
gerada** `quantity_available` (`generated always as (quantity_on_hand -
quantity_reserved) stored`) e de aplicar a margem (mesmo sendo 0) como uma
função pura de leitura em `lib/commerce`, com o valor vindo de uma
variável de ambiente/constante — não porque o valor mude hoje, mas porque
uma mudança futura de política (ex.: um evento de alta demanda em que o
dono queira reservar uma folga) deve ser um ajuste de configuração, não
uma migration.

### 6.2 Oversell — o que já existe e o que falta decidir

`adjust_inventory` já **recusa** (erro `23514`,
`adjustment_below_reserved_inventory`) gravar um novo saldo do Olist menor
que as reservas nativas já ativas — isto é o guard-rail estrutural contra
sobrevenda por sync: o site nunca aceita silenciosamente um saldo Olist
que já foi vendido pelo próprio site. Política proposta para quando isso
acontece (ex.: uma venda grande no PDV físico zera o estoque enquanto
carrinhos nativos ainda têm reserva ativa):

1. O worker de polling (Seção 5.2) **não trava o processamento do lote inteiro** — captura
   o erro por item, segue para o próximo produto.
2. Loga/alerta imediatamente como "divergência de estoque — risco de
   sobrevenda" (Seção 9) com o `product_variant_id`, o saldo recebido e a
   reserva atual — nunca com dados de cliente.
3. **Não força** o saldo para baixo automaticamente — as reservas ativas
   têm precedência até expirarem ou serem confirmadas/liberadas
   naturalmente pelo próprio fluxo de checkout; a correção real do saldo é
   aplicada assim que ele volta a ser ≥ reservado.
4. Se uma reserva **já virou pedido pago** (caso raro — a venda física
   aconteceu entre a reserva nativa e a confirmação do pagamento no site)
   e o Olist não tem fisicamente o item, é um esgotamento real — a
   política aprovada é **cancelar o pedido** (Seção 6.3, detalhada abaixo
   porque o dono confirmou que isto é requisito do canário, não um caso
   raro a tratar manualmente depois).

### 6.3 Cancelamento e estorno pós-pagamento

**Atualizado em 2026-09-25 — ver [`order-cancellation-and-returns.md`](order-cancellation-and-returns.md)
para a política completa e atual.** Esta seção ficava desatualizada em
relação à decisão mais recente do dono e foi substituída por aquele
documento; mantida aqui só como ponteiro, não repete o conteúdo.

Resumo do que mudou desde a versão original desta seção: o estorno é
**sempre manual** nesta fase (painel do provedor, SLA 24h úteis) — a
chamada real de estorno em cada adapter de pagamento **não é** mais
bloqueadora do canário, é fase futura. O cancelamento do canário também é
manual (WhatsApp + painel do Olist) — o evento `order.cancel` automatizado
ao outbox (Seção 7 abaixo) também **não é** mais bloqueador do canário,
vira Fase 1+. Ver `canary-minimum-scope.md` §3 para o registro formal
dessa reclassificação.

O que continua válido e reaproveitável sem mudança: `orders.status`
permite `confirmed → cancelled` (doc 82 §3); `createNativeRefund`/
`transitionNativeRefund` (`lib/db/nativePayment.ts:98,136`) continuam o
mecanismo certo para registrar o estorno manual na ledger nativa, mesmo
sem uma chamada de API automática por trás dele.

## 7. Export de pedido site → Olist

**Reaproveita 82 integralmente**, sem alteração: o gatilho é a transição
`pending → confirmed` de `orders.status` dentro de
`apply_verified_payment_transition` (mesma transação, mesmo `INSERT` em
`integration_outbox`, mesma dupla camada de idempotência, mesmo backoff,
mesma reconciliação — ver 82 §4–§10 para os detalhes completos, incluindo o
DDL exato de `integration_outbox`/`integration_errors`). Este documento não
repete esse conteúdo; a única atualização é de contexto:

- 82 já classificava isto como necessário para operação real (não como
  bloqueador de correção de pagamento/estoque). O dono agora confirma que é
  **bloqueador do canário** — atualiza a prioridade, não o design.
- O payload usa `numeroPedidoEcommerce` (Seção 2.3) para carregar a
  referência do pedido Persi.
- `order.cancel` pós-confirmação **volta a ser `POST_V1_OPERATIONAL_GAP`**
  (atualizado em 2026-09-25 — ver Seção 6.3 e
  [`order-cancellation-and-returns.md`](order-cancellation-and-returns.md)):
  o cancelamento do canário é manual no painel do Olist, então nenhum
  evento automatizado ao outbox é necessário até a Fase 1+.

### 7.0 Modo dry-run obrigatório fora de produção (2026-09-25, Seção 14.1)

**Não há sandbox Olist (Seção 2.6)** — qualquer chamada real de criação de
pedido, em qualquer ambiente que não seja produção, criaria um pedido real
na conta Olist da Persi. Isto muda o design do worker de drenagem do
outbox (82 §8): ele precisa checar um modo de operação **antes** de chamar
o adapter HTTP, não depois.

- Variável `OLIST_ORDER_EXPORT_MODE`, valores `dry_run` (default) ou
  `live`. Lida uma vez pelo worker, nunca pelo browser (só server-side,
  mesmo padrão de toda credencial deste documento).
- **`dry_run`** (default, obrigatório em qualquer ambiente que não seja
  produção): o worker monta o payload completo (Seção 2.3, snapshot
  congelado de `order_items`/`order_addresses`, exatamente como 82 §3
  especifica), grava a linha em `integration_outbox` com `status='sent'` e
  um `external_reference` sintético (ex.: `'DRY_RUN:' || outbox.id`) — mas
  **nunca chama a API do Olist**. O resultado fica indistinguível de um
  envio real para efeito de auditoria/consulta (a linha existe, tem
  payload, tem timestamp), exceto pelo prefixo `DRY_RUN:` no
  `external_reference`, que também impede a escrita de criar uma linha
  colidente em `external_mappings` (Seção 6) com um `external_id` real.
- **`live`**: comportamento pleno de 82 — chama a API do Olist de verdade.
  **Proibido fora de produção** salvo override explícito e documentado por
  pedido específico (ex.: um teste controlado único, decidido e registrado
  pelo dono antes de rodar, nunca uma configuração de ambiente permanente
  em staging). O worker deve checar `isProductionRuntime()`
  (`lib/runtime/runtime-environment.ts:25`, já existente — autoridade única
  de ambiente do projeto, não `NODE_ENV`) antes de aceitar `live`: se
  `isProductionRuntime()` for `false`, `live` é recusado
  incondicionalmente, mesmo com `OLIST_ORDER_EXPORT_MODE=live` configurado
  — as duas condições (`live` + `isProductionRuntime() === true`) precisam
  ser verdadeiras juntas. Isto reaproveita um mecanismo já existente e já
  testado, sem inventar uma segunda forma de detectar ambiente.
- Consequência para o Passo seguinte (implementação): staging pode e deve
  continuar **lendo** o Olist real (catálogo/estoque/preço, Seção 5 — não
  há dado sensível nem efeito colateral numa leitura), mas o export de
  pedido em staging roda sempre em `dry_run` até decisão explícita em
  contrário.

### 7.1 Dados fiscais (CPF/CNPJ/IE) — reinvestigação

O dono confirmou que CPF/CNPJ **chega hoje ao Olist** em pedidos do site,
o que contradiz o achado anterior desta mesma rodada ("Woo não recebe
CPF/CNPJ na criação do pedido" — Apêndice, tabela Woo). Reinvestigação
read-only, focada em encontrar o caminho exato:

**Confirmado, com citação exata**:

- `createPendingOrder` (`services/woocommerce/orders.ts:169-228`), o único
  ponto deste repositório que cria um pedido no Woo, **continua sem nenhum
  campo de CPF/CNPJ/IE no payload que envia** — `toWooAddress`
  (orders.ts:153-167) não tem esse campo, e nenhuma outra chave do corpo
  (`billing`/`shipping`/`meta_data`/`line_items`/etc.) carrega documento
  fiscal. Isto não mudou com a reinvestigação — é código real, lido de
  novo linha a linha.
- Existe, sim, um campo `billing_cpf` neste ecossistema, mas em um lugar
  diferente do fluxo de checkout: **perfil da conta do cliente**, não o
  pedido. `wordpress-plugin/persi-headless-account/src/CustomerWorkspace/CustomerWorkspaceService.php:42,54`
  lê e grava `billing_cpf` como **user-meta do WordPress** (`get_user_meta`/
  `update_user_meta` na conta do cliente), exposto ao site via
  `app/(institutional)/minha-conta/perfil/page.tsx` — é lá que o cliente
  digita o CPF **uma vez, no perfil**, não a cada compra.
- `getOrderConfirmationDetails` (`services/woocommerce/orders.ts:438-476`)
  **lê de volta** `billing.cpf`/`billing.cnpj` da resposta do Woo
  (`GET orders/{id}`) para exibir na confirmação — ou seja, o pedido
  Woo **acaba tendo** esses campos preenchidos por ocasião da leitura,
  mesmo sem este app tê-los enviado na criação.

**O elo que falta — não encontrado neste repositório**: entre "o cliente
salvou o CPF no perfil" e "o pedido Woo tem `billing.cpf` preenchido" não
existe nenhum código, neste repositório (rastreado ou não), que copie um
para o outro. `createPendingOrder` envia `customer_id` quando o cliente
está logado (achado já registrado no Apêndice) — a hipótese mais
consistente com o que existe é que o **próprio WooCommerce**, ou um plugin
de campos brasileiros instalado diretamente no WordPress ao vivo (o
padrão do nome `billing_cpf`/`billing_cnpj` é exatamente o de plugins como
"WooCommerce Extra Checkout Fields for Brazil", muito comuns em lojas
brasileiras), copia o `billing_cpf` salvo no perfil do cliente para o novo
pedido no momento em que o Woo processa um `customer_id` conhecido — mas
esse plugin/comportamento **não está neste repositório** (nem na parte
versionada, nem em `wordpress-plugin/`), então não é confirmável por
leitura de código, só no ambiente WordPress ao vivo.

**Consequência prática, honesta sobre os limites do que foi encontrado**:

- O caminho só cobre **clientes logados que já salvaram CPF no perfil**
  antes da compra. Uma compra de convidado (guest, sem `customer_id`), ou
  de um cliente logado que nunca preencheu o perfil, **não teria** CPF no
  pedido Woo por este caminho — se o dono vê CPF chegando ao Olist para
  *todo* pedido, incluindo convidados, a origem provavelmente não é este
  mecanismo, e sim preenchimento manual (equipe) ou o próprio Olist
  completando o dado a partir do seu próprio cadastro de cliente (casado
  por e-mail/telefone/CPF já conhecido de uma compra anterior) — nenhuma
  das duas é verificável por este repositório.
- **CNPJ, Inscrição Estadual e tipo de pessoa (PF/PJ) não existem em
  nenhum lugar deste código** — nem no perfil (`CustomerWorkspaceService.php`
  só tem `billing_cpf`), nem no checkout, nem no pedido. Se a Persi atende
  cliente pessoa jurídica hoje, o CNPJ/IE desses pedidos não vem de
  nenhum mecanismo que este repositório construiu.

**O que a exportação nativa (Seção 7) precisa enviar**, dado o que existe:

- O checkout nativo **já captura e criptografa** contato + endereço via
  `checkoutPii`/`nativeCheckoutPii` (Gate 3) — mas o campo de documento
  fiscal dentro desse envelope (`contact.taxDocument`, usado hoje só para
  os provedores de pagamento) **precisa ser propagado para o payload de
  export ao Olist** (`consumidorFinal.cpfCnpj`, Seção 2.3) — isto ainda
  não existe, é trabalho novo do outbox (Seção 7/82), não um reaproveitamento.
- **Tipo de pessoa** (PF/PJ) precisa ser inferido do formato do documento
  (11 dígitos = CPF, 14 = CNPJ) já que não existe um campo dedicado hoje.
- **IE**: como não é capturado em lugar nenhum, a exportação nativa não
  tem de onde tirar esse dado a menos que o dono decida adicionar captura
  disso ao checkout — não assumido aqui, fica como pergunta em aberto
  (Seção 12, item 8).
- Diferente do caminho Woo atual (que depende de perfil salvo + um
  mecanismo não confirmável), a exportação nativa pode ser **mais
  completa por padrão**: como o checkout nativo já teria capturado o
  documento fiscal (obrigatório no formulário de PII, inclusive para
  convidados — ver Seção 2 do design do Gate 3), toda exportação de
  pedido pago já carregaria `cpfCnpj`, sem depender de o cliente ter perfil
  salvo.

### 7.2 Sync de cancelamento Olist→site — polling (Fase 1, 2026-09-25)

**Decisão do dono (mesma rodada de 14.6)**: assim como catálogo/preço/
estoque, a situação do pedido também é sincronizada por **polling**, não
pelo webhook "Atualização de Situação de Pedido" (Seção 2.2/5.5, adiado).
Isto é a implementação concreta da política já registrada em
[`order-cancellation-and-returns.md` §5](order-cancellation-and-returns.md#5-sincronização-com-o-olist)
("um cancelamento iniciado no Olist deve refletir no site") e fecha o
bloqueador `canary-minimum-scope.md` §5.3 — a diferença é que, com polling,
a detecção passa a ser automática, não uma ação administrativa manual
disparada por quem percebe a divergência.

**Escopo do polling — só pedidos exportados e ainda não finalizados**, não
o catálogo inteiro de pedidos:

```sql
-- Universo do polling a cada ciclo: pedidos já exportados ao Olist
-- (integration_outbox.status='sent', ou seja, já têm external_reference)
-- cujo orders.status ainda não chegou a um estado terminal do lado nativo.
select o.id, em.external_id as olist_order_id
from orders o
join integration_outbox io on io.internal_id = o.id
  and io.destination = 'olist' and io.entity_type = 'order'
  and io.event_type = 'order.export' and io.status = 'sent'
join external_mappings em on em.system = 'olist'
  and em.entity_type = 'order' and em.internal_id = o.id
where o.status = 'confirmed'  -- completed/cancelled já são terminais, saem do polling
```

**Mecânica**:

1. Cron (mesma família de job dos demais, cadência própria — mais lenta que
   estoque/preço, já que cancelamento pós-pagamento é evento raro, não
   contínuo; frequência exata **A CONFIRMAR na implementação**, dentro do
   orçamento da Seção 14.4).
2. Para cada pedido do universo acima, consulta `GET /pedidos` filtrando
   pelo id/`numeroPedidoEcommerce` (Seção 2.3) e lê `situacao` (enum
   confirmado na Seção 2.3: `2 = Cancelada`).
3. Se `situacao = 2`: aciona a **mesma orquestração já exigida por**
   `canary-minimum-scope.md` §5.3 — `apply_verified_payment_transition`
   para `orders.status: confirmed → cancelled` e `createNativeRefund`/
   `transitionNativeRefund` para o registro do estorno manual na ledger
   — rodando como `persi_worker`, nunca SQL manual. A diferença em relação
   ao §5.3 original é só o **gatilho**: antes era uma ação administrativa
   humana ao perceber a divergência; agora é este job, automaticamente, o
   que **fecha** o bloqueador em vez de só mitigá-lo com um botão manual.
4. Se `situacao` for qualquer outro valor (inclusive os operacionais —
   Faturada, Enviada, etc.): não faz nada nesta fase — status
   operacional/rastreio ao cliente continua Fase 2 (Seção 11), só
   cancelamento é tratado aqui.
5. Idempotência: `apply_verified_payment_transition` já é idempotente por
   transição de estado (Seção 3) — um pedido já `cancelled` sendo
   re-verificado num próximo ciclo simplesmente sai do universo do
   `select` acima (não é mais `status='confirmed'`), então não há reenvio
   duplicado de estorno a prevenir no polling em si.

**Nota de custo**: este polling consome requisições adicionais no mesmo
orçamento da Seção 14.4, mas o volume esperado é pequeno — só pedidos já
pagos e ainda não finalizados, não o catálogo inteiro. Não deve competir de
forma relevante com o polling de estoque/preço pelo mesmo motivo.

## 8. Convivência com o Woo durante a transição

Confirmado pelo dono nesta rodada: **a integração Olist↔Woo já existe e é
oficial**, e a direção da chamada é **Olist → Woo**: é o Olist quem chama a
API REST do WooCommerce (não um plugin no WordPress chamando o Olist) para
sincronizar produto/preço/estoque e para ler os pedidos feitos no Woo. Ela
**não deve ser alterada, pausada ou desligada**; convive até o fim da
transição.

Consequência direta para a Seção 2.6: como é o **Olist quem inicia** a
chamada para o Woo (usando alguma credencial `WOOCOMMERCE_CONSUMER_KEY`/
`SECRET` configurada **dentro do painel do Olist**, não neste
repositório), a integração nativa não tem nenhuma credencial existente
para reaproveitar nessa direção — ela precisa da sua **própria** credencial
do lado Olist (um "Aplicativo" OAuth v3 dedicado, client_id/client_secret
gerados na conta Olist — Seção 2.6), e o acesso/plano necessário para isso
é **A CONFIRMAR PELO DONO no painel do Olist** (item já listado na Seção
12, agora com a causa exata).

Isso implica um modelo de convivência simples porque os dois caminhos de
checkout são **estruturalmente exclusivos por sessão**: uma compra passa
pelo carrinho/checkout legado do Woo (que continua criando pedido real no
Woo, que o Woo então entrega ao Olist como já faz hoje) **ou** pelo
carrinho/checkout nativo do Gate 3 (`/api/cart/native/*`,
`/api/checkout/native/*`), nunca os dois para a mesma compra. Consequência:

- **Sem risco de baixa dupla de estoque no Olist**: cada pedido chega ao
  Olist por exatamente um caminho — via Woo (hoje, para todo tráfego não
  canário) ou via o outbox nativo (Seção 7, só para tráfego canário). Não
  há um pedido que passe pelos dois.
- **Sem risco de pedido duplicado**: mesma razão — a exclusividade de
  sessão é o que evita a dupla exportação, não uma verificação adicional
  de "este pedido já foi enviado por outro caminho".
- **O outbox nativo é uma integração paralela e independente** — deve usar
  seu próprio "Aplicativo"/credencial OAuth no Olist (Seção 2.6, "máx. 5
  aplicativos por conta"), nunca reaproveitar ou modificar a credencial que
  a integração Olist↔Woo já usa, para não arriscar interferir num canal já
  em produção.
- **Resolvido nesta rodada**: a integração Olist↔Woo **não é**
  `wordpress-plugin/persi-catalog-engine` (que, por código, só faz
  catálogo/GTIN via a API do Olist — `find_by_sku`/`product_detail`,
  nunca chama o Woo) — é o Olist quem chama o Woo diretamente, configurado
  do lado Olist. Isso também esclarece por que nenhum código deste
  repositório participa da integração hoje (Seção 10, tabela do Woo, item
  3): ela nunca precisou de código no WordPress nem no Next.js, só de
  credenciais Woo configuradas no painel do Olist.
- O sync Olist→site (Seção 5) **duplica dados** que o Olist já está
  mandando para o Woo, mas por um canal HTTP direto e independente — não
  lê nem escreve na integração Woo↔Olist, só consulta a mesma fonte
  (Olist) que ela também consulta. Isso é intencional: esperar que o dado
  passe por Woo→Postgres (como hoje) adicionaria uma etapa e uma latência
  a mais que o canário não deveria herdar.

## 9. Segurança

Sem novidade em relação ao padrão já usado neste projeto para os outros
provedores (Inter/Mercado Pago/PagBank/Melhor Envio) — `AGENTS.md` §19.3/§23
e 82 §11 já cobrem isto; aplicado aqui:

- Credenciais (client_id/client_secret OAuth, token) só em variável de
  ambiente privada, nomes propostos: `OLIST_CLIENT_ID`,
  `OLIST_CLIENT_SECRET`, `OLIST_WEBHOOK_SECRET` (se o Olist oferecer
  assinatura de webhook — Seção 5.2 item 1) — nunca prefixo `NEXT_PUBLIC_`,
  nunca em `.env.example` com valor, nunca em log.
- Identidade de execução: o worker de sync (webhook + reconciliação +
  drenagem do outbox) roda como `persi_worker`
  (`lib/db/nativeCommerceAuthority.ts`), nunca `persi_app` — mesma
  separação já usada para `apply_verified_payment_transition`/
  `reclaim_expired_native_reservations`. A chamada HTTP ao Olist em si é
  server-only, nunca alcançável de uma rota voltada ao navegador — mesmo
  padrão dos adaptadores de pagamento.
- Nenhum segredo, payload bruto do Olist, ou dado pessoal do cliente em
  log — apenas identificadores (`idProduto`, `product_variant_id`,
  `order.id`, código de erro sanitizado), mesmo padrão de
  `lib/observability/nativeCommerceEvents.ts`.

## 10. Observabilidade e runbook de falha

Reaproveitando o formato de alerta já proposto em 07 (mapping ambíguo,
SKU/GTIN duplicado, saldo negativo, sequência de 401/429/5xx, outbox
envelhecida), com runbooks específicos:

| Falha | Detecção | Ação |
| --- | --- | --- |
| Olist fora do ar (5xx/timeout na API) | erro de rede/HTTP no worker | backoff exponencial (mesmo esquema de 82 §8); o próximo ciclo de polling (5.2) cobre o período fora do ar assim que o Olist volta; nenhuma venda é bloqueada — o site continua vendendo com o último saldo conhecido, sujeito à margem de segurança (Seção 6.1) |
| Ciclo de polling atrasado/mais lento que o esperado | métrica de cobertura (Seção 5.2, item 4) mostra SKUs há mais tempo que o esperado sem leitura | alerta de observabilidade — pode indicar rate limit insuficiente para a cadência configurada (Seção 14.4) |
| Divergência de estoque (Olist diz menos do que o site tem reservado) | `adjust_inventory` retorna `23514` | ver política de oversell, Seção 6.2 |
| `401`/`403` do Olist | resposta da API | nunca retenta no mesmo schedule de falha transitória — alerta imediato de credencial expirada/inválida (mesma regra de 82 §8) |
| Produto Olist sem par no site | polling não encontra `external_mappings` | grava em `integration_inbox` como não processável, não alerta a cada ciclo (seria ruído para os SKUs legitimamente fora do mapeamento — Seção 4) |

## 11. Fases

**Atualizado em 2026-09-25**: ver
[`canary-minimum-scope.md`](canary-minimum-scope.md) para a lista
consolidada e atual do que bloqueia o canário e do que foi adiado — a
divisão abaixo ficou desatualizada em dois pontos específicos (cancelamento
e estorno, ver nota) e não deve ser lida isoladamente.

**Fase 1 (canário)** — bloqueadora para o primeiro pedido nativo real:

- Derivação/verificação do mapeamento SKU (Seção 4, agora por query direta,
  sem chamada ao Olist para descobrir correspondência).
- Sync Olist→site de catálogo/preço/estoque, **por polling** (Seção 5.2 —
  webhook adiado para Fase futura, Seção 14.6/5.5).
- Export de pedido pago site→Olist via outbox (Seção 7, = 82 completo),
  em modo `dry_run` fora de produção (Seção 7.0/14.1). `order.cancel`
  (site→Olist) **não** faz parte disto — ver nota abaixo.
- Sync de cancelamento Olist→site, **por polling** dos pedidos exportados
  ainda não finalizados (Seção 7.2) — fecha `canary-minimum-scope.md` §5.3.
- Runbook mínimo de falha (Seção 10).

**Nota (substitui o que esta seção dizia antes sobre cancelamento/estorno)**:
o cancelamento e o estorno do canário são **manuais** (WhatsApp + painel do
Olist + painel do provedor de pagamento) — ver
[`order-cancellation-and-returns.md`](order-cancellation-and-returns.md).
Não há trabalho de código bloqueando o canário por causa disso; o que
antes estava listado aqui (`order.cancel` automatizado, chamada real de
estorno nos três adapters de pagamento) passa para a Fase 1+ e para uma
fase futura, respectivamente.

**Fase 1+ (logo após o canário, antes de ampliar tráfego)**:

- Botão de cancelamento no painel do cliente e página "Acompanhar pedido"
  para convidados (`order-cancellation-and-returns.md` §4, §6).
- Evento `order.cancel` automatizado ao outbox (Seção 7).

**Fase 2 (pós-canário)** — não bloqueia o primeiro pedido:

- Status operacional/logístico **completo** do pedido (todos os valores do
  enum `situacao`, Seção 2.3 — faturado, enviado, entregue etc.) refletido
  de volta no site para rastreio ao cliente. **Diferente do cancelamento**
  (`situacao=2`), que já é Fase 1 via polling (Seção 7.2) — esta fase
  estende o mesmo polling para os demais valores do enum, hoje ignorados
  de propósito (Seção 7.2, item 4).
- Nota fiscal (emissão, XML, DANFE) — hoje já é responsabilidade do Woo/
  Olist; migrar apenas quando o volume canário justificar.
- Rastreio de entrega ao cliente via native commerce.
- Notificações transacionais nativas ligadas a esses eventos (depende
  também de `docs/database/83-transactional-email-v1-design.md`, hoje
  design-only).

**Fase seguinte** — devolução por arrependimento pelo site
(`order-cancellation-and-returns.md` §3, §6) e estorno automático via API
de cada provedor (fase futura, sem prazo definido).

## 12. O que depende do dono

**Resolvido nesta rodada** (mantido aqui só como registro, nada a fazer):
qual `price_list` recebe o preço Olist (única — Seção 5.4); margem de
segurança (0 — Seção 6.1); política de oversell (cancelar — Seção 6.2/6.3);
tratamento de kit (Seção 4); timing de baixa de estoque no Olist (na
aprovação — Seção 2.4); direção da integração Olist↔Woo (Olist chama o Woo
— Seção 8); mapeamento SKU (Woo SKU = Olist SKU, derivação direta — Seção 4).

**Resolvido em 2026-09-25** (rodada de pesquisa pública, sem chamada à API
do Olist): cancelamento é `situacao=2` via atualizar situação, não um
endpoint dedicado (Seção 2.3); contagem de tentativas/backoff de webhook
(Seção 2.2); estrutura de permissões por módulo dos "Aplicativos" (Seção
14.3); estrutura do objeto `ecommerce`/canal na criação de pedido (Seção
2.3/14.7); confirmação do Olist de que não há dedupe server-side por
`numeroPedidoEcommerce` (Seção 2.3).

**Resolvido em 2026-09-25 (respostas diretas do suporte Olist, plano
"Impulsione")**: rate limit real = 60 req/min por conta, compartilhado com
o Woo (Seção 14.4); teto do site definido pelo dono em ~25–30/min (Seção
14.4); decisão de não usar o token da integração "API do ERP" em nenhum
ambiente, usando `ecommerce.id` no payload do pedido em vez disso (Seção
14.7); ordem de configuração no painel (Seção 14.8).

**Ainda em aberto**:

1. Acesso real ao Olist: criar os dois "Aplicativos" OAuth v3 dedicados ao
   native commerce, com as permissões exatas da Seção 14.3, e a integração
   "Ecommerce da Olist" para obter o `idEcommerce` (Seção 14.7/14.8) — nunca
   reaproveitar a credencial que a integração Olist↔Woo já usa (Seção 8).
2. Não há sandbox Olist encontrado para os "Aplicativos" OAuth v3 —
   confirmar se o dono concorda em testar contra a conta real com cuidado
   (mitigado pelo modo `dry_run` para pedidos, Seção 14.1; sem mitigação
   equivalente para o polling de leitura, que já é seguro por natureza —
   leitura não cria efeito colateral).
3. Confirmar se existem produtos kit/composição ativos no catálogo hoje
   (a Seção 4/6.3 já cobre como tratá-los quando existirem).
4. Confirmar se há campo de código de cupom nomeado na API de pedido do
   Olist, ou se descontos de cupom precisam virar `valorDesconto` (valor
   plano) no export (Seção 2.3, Apêndice item "Cupom" da tabela Woo).
5. **Decorrente da política de cancelamento (Seção 6.3)**: para cada
   provedor de pagamento (Banco Inter, Mercado Pago, PagBank), confirmar
   na documentação oficial de cada um: existe endpoint de estorno
   total/parcial, prazo para executar, e alguma taxa envolvida. Pix/cartão
   têm estorno real na maioria dos bancos/adquirentes; boleto normalmente
   não é "estornável" (é apenas baixado/expirado) — como tratar um
   cancelamento pós-pagamento de boleto Inter especificamente é uma
   decisão pendente.
6. **Alta prioridade, ver Seção 14.6/14.8 item 1**: confirmar com o
   suporte Olist (ou inspecionando o painel `Aba E-commerce` sem alterar
   nada) se cadastrar as URLs de webhook deste projeto (estoque, preço,
   situação de pedido) substitui ou conflita com a URL de notificação já
   configurada pela integração oficial Olist↔Woo, e se essa configuração
   vive na mesma tela da integração "Ecommerce da Olist"/"Token API"
   (Seção 14.7). A tela de configuração documentada publicamente usa
   singular ("a URL da notificação de pedidos"), o que sugere um único
   slot por tipo de evento por conta — risco real de sobrescrever a
   integração Woo em produção, não uma formalidade.
7. **Novo, decorrente da Seção 14.7**: confirmar na implementação se o
   `ecommerce.id`/canal precisa estar "ativo" do lado Olist (vinculado a um
   token válido da integração "Ecommerce da Olist") para que a reserva de
   estoque automática do Olist (Seção 2.5) funcione, ou se basta o campo
   estar preenchido no pedido — só verificável com um pedido de teste real.
8. **Novo, decorrente da reinvestigação de CPF/CNPJ** (ver relatório
   separado desta rodada): confirmar se existe um plugin de campos
   brasileiros instalado no WordPress ao vivo (não visível neste
   repositório) que copia `billing_cpf` do perfil do cliente para o
   pedido — isso determina se a exportação nativa de pedido pode confiar
   no mesmo mecanismo ou precisa capturar/enviar o documento fiscal por
   conta própria (o checkout nativo já criptografa isso via
   `checkoutPii`/`nativeCheckoutPii` — falta só ligar ao payload de
   export). Também confirmar se CNPJ/Inscrição Estadual são necessários
   para algum cliente pessoa jurídica (hoje não capturados em lugar
   nenhum do código).

## 13. Tamanho estimado e paralelização com o Gate 3

Nenhum destes itens toca as rotas `/api/cart/native/*`/`/api/checkout/native/*`
do Gate 3 nem seu banco de dados de carrinho/checkout — podem ser
desenvolvidos **em paralelo**, sem risco de conflito, exceto pelo ponto de
integração único (Seção 7 usa `apply_verified_payment_transition`, já
existente e já usado pelo Gate 3 indiretamente via `submit_native_checkout`
— qualquer mudança ali precisa ser coordenada, mas é uma migration aditiva,
não uma reescrita).

| Item | Tamanho estimado | Paralelizável com Gate 3? |
| --- | --- | --- |
| Migration `integration_outbox`/`integration_errors` (82 §9) | Pequeno (DDL já especificado) | Sim |
| Adapter HTTP Olist (OAuth2, client de baixo nível) | Médio (autenticação OAuth2 + rate limit awareness) | Sim |
| Worker de drenagem do outbox (pedido) | Médio | Sim, mas depende do adapter acima |
| Derivação/verificação de mapeamento SKU (Seção 4) | Pequeno (é uma consulta + revisão de amostra) | Sim |
| Job de polling de estoque/preço (Seção 5.2, substitui webhook+reconciliação separados) | Médio | Sim, reaproveita padrão de cron existente |
| Job de polling de situação/cancelamento (Seção 7.2) | Pequeno-Médio | Sim, depois que o outbox (linha abaixo) existir |
| Rota(s) de webhook Olist (estoque/preço/situação) | Médio | **Adiado — Fase futura (Seção 14.6/5.5), não Fase 1** |
| Wrapper `SECURITY DEFINER` + grant para `adjust_inventory`/preço via `persi_worker` | Pequeno (migration aditiva) | Sim |
| Cálculo de margem de segurança em leitura (Seção 6.1) | Pequeno | Sim, mas só faz sentido depois que o Gate 3 tiver um ponto de checagem de estoque no carrinho (hoje não existe — gap separado, fora deste documento) |
| Decisão de qual `price_list` recebe o preço Olist (Seção 5.4) | Depende do dono, não de código | N/A |

## 14. Ajustes obrigatórios antes da implementação (2026-09-25)

Revisão do plano acima, feita antes de qualquer código ser escrito. Os
itens abaixo **alteram** o design de §5/§7 (já refletido nas seções
correspondentes, citadas em cada item) e **adicionam** o que faltava
(apps/permissões, orçamento de rate limit). Nenhuma migration foi aplicada;
nenhuma chamada à API do Olist foi feita além de leitura de documentação
pública.

### 14.1 Export de pedido — dry-run obrigatório fora de produção

Ver Seção 7.0 (texto completo do mecanismo, já incorporado ao design do
worker de drenagem). Resumo: `OLIST_ORDER_EXPORT_MODE=dry_run|live`,
default `dry_run`; `live` exige `isProductionRuntime() === true`
(`lib/runtime/runtime-environment.ts`) **e** a variável configurada como
`live` — as duas juntas, nunca uma sozinha.

### 14.2 Webhook nunca é autoridade (regra mantida para quando o webhook existir — Fase futura, Seção 14.6)

**Superado como mecanismo da Fase 1** pela decisão de polling (Seção
14.6/5.2/7.2) — nenhum webhook é cadastrado agora, então esta regra não tem
o que proteger ainda. Mantida como requisito **já fixado** para quando o
webhook virar otimização futura (Seção 5.5): todo webhook (estoque, preço,
situação de pedido) só identificaria *o quê* mudou; a gravação usaria
sempre um re-query síncrono à API do Olist, nunca o valor do corpo do
webhook. A rota exigiria um segredo próprio do site (`OLIST_WEBHOOK_SECRET`,
Seção 14.3) na URL ou em header — não uma assinatura do Olist, que não é
documentada publicamente.

### 14.3 Apps Olist — permissões exatas e variáveis de ambiente

Confirmado nesta rodada ([Aplicativos API V3 — Configurações e
Utilização](https://ajuda.olist.com/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao)):
permissão é granular por módulo, 3 níveis (**Leitura** / **Incluir e
editar** / **Excluir**), máximo 5 aplicativos por conta. Dois apps
dedicados ao native commerce, nenhum reaproveitando a credencial da
integração oficial Olist↔Woo (Seção 8):

| App | Permissões a marcar no painel Olist | Variáveis de ambiente (nomes só — sem valor) |
| --- | --- | --- |
| **Persi Native Sync — Catálogo** | Produtos: Leitura · Estoque: Leitura · Listas de preço: Leitura | `OLIST_SYNC_CLIENT_ID`, `OLIST_SYNC_CLIENT_SECRET` |
| **Persi Native Sync — Pedidos** | Pedidos de venda: **Leitura + Incluir e editar** (nunca Excluir) | `OLIST_ORDERS_CLIENT_ID`, `OLIST_ORDERS_CLIENT_SECRET` |

**Correção em relação à recomendação anterior desta mesma rodada**: o app
de Pedidos precisa também de **Leitura**, não só escrita — antes de
(re)enviar um pedido depois de um timeout/erro ambíguo (Seção 7 / 82 §7,
Camada 2 de idempotência), o adapter precisa **consultar** por
`numeroPedidoEcommerce` para checar se o pedido já existe no Olist antes de
criar de novo. Escrita sem leitura tornaria essa checagem impossível.

Variáveis adicionais, não ligadas a nenhum app OAuth específico:
`OLIST_WEBHOOK_SECRET` — token usado para validar as três rotas de webhook
(Seção 5.2/14.2, Fase futura); `OLIST_ORDER_EXPORT_MODE` (Seção 14.1/7.0);
`OLIST_ECOMMERCE_CHANNEL_ID` — o `idEcommerce` numérico obtido ao criar a
integração "Ecommerce da Olist" (Seção 14.7/14.8) uma única vez; **não é um
segredo** (é um identificador de canal, não uma credencial), mas listado
aqui por ser uma variável nova que o dono precisa cadastrar.

Nenhuma dessas sete variáveis tem valor secreto definido por este
documento — são os **nomes** que o dono cadastra no hPanel do staging (e,
depois, em produção) conforme os apps/integração forem criados no painel
Olist (Seção 14.8 dá a ordem exata).

### 14.4 Orçamento de rate limit — recalculado com o plano real, token bucket em Postgres

**Confirmado pelo suporte Olist em 2026-09-25**: plano da Persi é
**"Impulsione", 60 requisições/min por conta** (leitura e escrita juntas,
não dois baldes separados — o suporte não distinguiu leitura de escrita ao
confirmar este número, diferente da tabela de referência pública da Seção
2.6, que separa os dois; tratar como **um único limite de 60/min
compartilhado entre leitura e escrita** até um teste real dizer o
contrário). Compartilhado com **todos** os aplicativos da conta, incluindo
a integração oficial Olist↔Woo, que já consome parte dele hoje, em
produção, de forma contínua e não medível por leitura de código.

**Decisão do dono**: teto do site = **~25–30 requisições/min**, reserva de
**≥50% para o Woo** (30/60 = exatamente 50%; a faixa 25–30 dá uma margem
extra abaixo da metade, não exatamente no limite). Baseline adotado neste
documento: **28/min**, meio da faixa.

**Consumidores do orçamento, recalculados** (base real: **3.080 SKUs**
mapeados, Gate 3 Passo 2, mapeamento Woo↔nativo 100% validado, reaproveitado
por SKU para Olist — Seção 4):

| Consumidor | Quando | Consome | Status |
| --- | --- | --- | --- |
| Integração oficial Olist↔Woo | Contínuo, hoje, em produção | Desconhecido — fora deste repositório | Fixo, fora do controle do site |
| Carga inicial (Seção 5.1) | Uma vez, execução manual | 1 leitura por SKU mapeado × 2 (estoque + preço), salvo endpoint em lote confirmado na implementação | Fase 1 |
| **Polling de estoque (Seção 5.2)** | A cada ciclo, por fatia | 1 leitura por SKU da fatia — sem endpoint v3 em lote/incremental confirmado | Fase 1, custo dominante |
| **Polling de preço (Seção 5.2/5.4)** | A cada ciclo, por fatia | 1 leitura por SKU da fatia — mesma ressalva | Fase 1 |
| **Polling de situação/cancelamento (Seção 7.2)** | A cada ciclo, só pedidos `confirmed` já exportados | 1 leitura por pedido no universo (volume baixo) | Fase 1 |
| Export de pedido (Seção 7) | A cada pedido pago (fora de `dry_run`) | 1 leitura (checar duplicata por `numeroPedidoEcommerce`, Seção 2.3) + 1 escrita (criar pedido) | Fase 1 |
| **Checagem de estoque no carrinho/checkout** | Por ação de carrinho/checkout, se implementada | 1 leitura por chamada | **Não existe no desenho atual** — o Gate 3 usa `inventory_levels` local (já sincronizado por polling), nunca chama o Olist ao vivo por ação de carrinho. Incluído aqui só porque foi pedido explicitamente; se o dono quiser essa checagem ao vivo como camada extra de segurança, é trabalho novo, não coberto por este documento, e o custo por requisição competiria diretamente com o polling pelo mesmo teto de 28/min — o volume dependeria do tráfego do site, não do tamanho do catálogo, e por isso não é dimensionável aqui sem uma estimativa de tráfego |
| Webhook → re-query | Por evento recebido | 1 leitura por evento | **Fase futura (Seção 14.6/5.5)** — zero nesta fase, nenhum webhook cadastrado |

**Cálculo de varredura completa do catálogo (3.080 SKUs), com o teto real
de 28/min dividido entre estoque e preço**:

| Divisão do teto (28/min) | Estoque | Preço | Tempo por varredura completa (3.080 SKUs) |
| --- | --- | --- | --- |
| Metade para cada | 14/min | 14/min | ≈ 220 min (~3h40) cada |
| 2/3 estoque, 1/3 preço | ~19/min | ~9/min | Estoque ≈ 162 min (~2h42); Preço ≈ 342 min (~5h42) |
| 1/3 estoque, 2/3 preço (preço mais frequente, Seção 5.2) | ~9/min | ~19/min | Estoque ≈ 342 min; **Preço ≈ 162 min (~2h42)** |

A terceira linha é a que melhor reflete a decisão já registrada (preço mais
frequente que estoque, Seção 5.2) — uma varredura completa de preço a cada
~2h42, de estoque a cada ~5h42, com 28 req/min. Isto é significativamente
mais lento do que o cenário especulativo anterior desta seção (baseado em
planos maiores não confirmados); **se este ritmo for insuficiente na
prática** (ex.: promoções que mudam de preço várias vezes ao dia), as
opções são: aumentar o plano contratado, usar o endpoint incremental v2
legado (Seção 5.2, custo por chamada menor se cobrir múltiplos SKUs por
request), ou aceitar essa latência como a troca pelo modelo "sem webhook"
desta fase (Seção 14.6). Nenhuma destas é decidida aqui.

**Mecanismo: token bucket compartilhado entre processos, em Postgres**
(decisão do dono — não fixed-window, e não em memória). Motivo: o achado
de `canary-minimum-scope.md` §5.1 (possíveis 2 processos Node na Hostinger)
se aplica igualmente aqui — um limitador em memória por processo permitiria
até 2× o teto real se os dois processos não compartilharem contador. Nova
função `SECURITY DEFINER`, mesmo espírito de `consume_admin_rate_limit`
(`supabase/migrations/20260912040000_distributed_admin_rate_limit.sql`) mas
com **algoritmo diferente** (token bucket com reposição contínua, não
janela fixa — token bucket absorve rajadas curtas sem permitir exceder a
taxa média, mais adequado a um limite externo real do que janela fixa, que
pode permitir um pico de 2× no limite entre duas janelas adjacentes):

```
consume_olist_rate_limit(p_bucket text, p_tokens_requested int, p_capacity int, p_refill_per_minute numeric)
  returns boolean  -- true = concedido, false = negado (chamador deve esperar/recusar)
```

Uma linha por `p_bucket` (ex.: `'olist_account'`, um único bucket para todo
o tráfego do site, já que o limite é por conta) em uma tabela nova,
guardando `tokens_available numeric` e `last_refill_at timestamptz`; a
função calcula a reposição desde `last_refill_at` (`elapsed_minutes *
p_refill_per_minute`, capado em `p_capacity`) antes de decidir conceder.
`persi_worker` como único grantee (mesmo padrão de `consume_admin_rate_limit`,
`persi_app` sem acesso). Migration listada, não aplicada.

**Backoff exponencial em 429**: se o Olist ainda assim devolver 429 (rate
limit oficial dele, não o nosso bucket local — os dois são independentes;
nosso bucket é preventivo, o 429 é o limite real do Olist), backoff
exponencial com jitter, mesmo esquema já usado em 82 §8, respeitando
`Retry-After` se o Olist enviar.

**Circuit breaker**: após N `429`/`5xx` consecutivos (número exato a
definir na implementação, sugestão inicial: 5), o worker para de tentar
por um período de resfriamento (ex.: 5 minutos) antes de tentar de novo —
estado também em Postgres (não em memória, mesmo motivo do bucket), para
que todos os processos parem juntos, não só o que detectou a falha.
Nenhuma venda é bloqueada por isso (Seção 10) — só o sync com o Olist pausa
temporariamente, o site continua com o último dado conhecido.

### 14.5 Reconciliação de preço — frequência obrigatória, mais curta que estoque

Ver Seção 5.2/5.4 (texto já incorporado — reconciliação e sync incremental
agora são o mesmo mecanismo de polling, não dois estágios separados). Preço
precisa de cadência **mais curta** que estoque por dois motivos
independentes: (a) um preço errado é visível ao cliente imediatamente
(Seção 5.2); (b) **se o webhook de preço um dia for implementado** (Fase
futura, Seção 5.5), ele só tenta reenviar 2 vezes (Seção 2.2) — bem mais
frágil que o de estoque (15 tentativas) — então mesmo depois de o webhook
existir, a reconciliação/polling de preço continuaria sendo a rede de
segurança primária, não um reforço. **Frequência exata: A CONFIRMAR na
implementação**, dependente do plano contratado (Seção 14.4) — a tabela de
varredura acima já dá o piso possível por plano; a cadência real de preço
deve ficar no lado mais frequente desse piso, estoque no lado menos
frequente, dividindo a reserva de 50% entre os dois.

### 14.6 Decisão: nenhum webhook cadastrado na Fase 1 — polling é a estratégia primária

**Risco original, que motivou esta decisão**: **não encontrado em
documentação pública** se webhooks são configurados por conta (uma única
URL por tipo de evento, compartilhada por todas as integrações) ou por
aplicativo/integração. A evidência encontrada aponta para configuração
**por conta**: a tela documentada
([Webhooks — Central de Ajuda](https://ajuda.olist.com/ecommerce-erps/webhooks);
comportamento de "Configurações → Webhooks" descrito em
[Webhooks do Tiny](https://tiny.com.br/api-docs/api2-webhooks-tiny)) usa
linguagem no singular ("a URL da notificação de pedidos"), sugerindo **um
único slot ativo por tipo de evento, por conta** — não uma lista de
assinantes. Se a integração oficial Olist↔Woo já usa esse mesmo slot, e
cadastrar as URLs de webhook deste projeto (`app/api/webhooks/olist/*`)
sobrescrever esse slot, o **sync Woo pararia de funcionar em produção** no
momento em que o native commerce fosse configurado — uma regressão grave em
algo que "já funciona" (AGENTS.md §3).

**Decisão do dono, 2026-09-25**: em vez de esperar a confirmação do suporte
Olist para prosseguir com webhooks, **a Fase 1 não usa webhook em
nenhuma hipótese** — a estratégia primária passa a ser **polling** (Seção
5.2 para catálogo/preço/estoque, Seção 7.2 para situação/cancelamento de
pedido), que não depende de cadastrar nenhuma URL no painel Olist e
portanto não tem esse risco. Consequências diretas:

- **Nenhuma rota de webhook deste projeto é cadastrada no painel Olist**
  enquanto o suporte não confirmar que múltiplos webhooks por
  tipo/conta são possíveis sem sobrescrever a integração Woo — sem prazo
  definido para essa confirmação, e sem bloquear a Fase 1 por causa dela.
- O **código** das rotas de webhook (Seção 5.5) permanece desenhado, mas
  **não é implementado nem cadastrado** nesta fase — vira otimização
  futura pura, avaliada só depois da confirmação do suporte.
- A implementação autorizada para a próxima rodada (mapeamento SKU,
  grants/função de preço, polling de estoque/preço, reconciliação) é
  **só leitura da API do Olist** — nenhuma escrita, nenhum cadastro de
  webhook, nenhuma chamada ao endpoint de criação de pedido (que
  continua coberto pelo modo `dry_run`, Seção 14.1, quando essa parte for
  implementada em rodada separada).

### 14.7 "API do ERP" / Token API não é usada pelo código — apps OAuth v3 fazem as chamadas, canal identificado pelo `ecommerce.id`

**Problema identificado pelo dono**: a integração legada "API do ERP"
("Token API"/"Ecommerce da Olist", Seção 2.6) usa um único token que dá
acesso à **conta inteira** — o oposto do modelo de permissão mínima por
módulo dos "Aplicativos" OAuth v3 (Seção 14.3). Colocar esse token em
qualquer `.env` (mesmo só em produção) reintroduziria exatamente o padrão
que este projeto evita para todo outro provedor (AGENTS.md §19.3/§23):
uma credencial "senha-mestra" em vez de uma credencial escopada.

**Pergunta respondida nesta rodada** (Seção 2.3, já incorporada):
`POST /pedidos` aceita `ecommerce: { id, numeroPedidoEcommerce }` no corpo
da requisição — **sim, o canal/integração pode ser indicado diretamente na
criação do pedido**, sem precisar autenticar essa chamada com o token da
integração "API do ERP". `ecommerce.id` é o identificador do canal (a
mesma peça vista como `dados.idEcommerce` no webhook de situação, Seção
2.2, e como `ecommerce.id`/`ecommerce.canalVenda` em `GET /pedidos`).

**Decisão adotada — mais forte que a proposta original do dono** (que já
prevendo o token só em produção como fallback): **o token da integração
"API do ERP" nunca precisa entrar no código, em nenhum ambiente**,
inclusive produção. Ele é necessário só **uma vez**, para criar/vincular a
integração "Ecommerce da Olist" no painel (Menu → Configurações → Aba
E-commerce, ou Loja de extensões — Seção 2.6) e obter o `idEcommerce`
resultante — depois disso, esse `idEcommerce` é um **identificador
numérico, não um segredo** (equivalente a um id de loja/canal), e pode
viver como configuração comum (`OLIST_ECOMMERCE_CHANNEL_ID`, Seção 14.3,
adicionada à lista de variáveis) usada por toda chamada `POST /pedidos`
feita pelo app OAuth v3 **Persi Native Sync — Pedidos** (Seção 14.3, já
com permissão de leitura+escrita em Pedidos de venda).

**Consequência para staging**: staging não precisa de nenhuma credencial
da integração "API do ERP" — só do app **Catálogo** (leitura) para as
rotinas de polling. Se a Fase de export de pedido (`dry_run`, Seção 14.1)
for testada em staging, ela usaria o app **Pedidos** e o mesmo
`OLIST_ECOMMERCE_CHANNEL_ID` de produção (o id do canal não é sensível e
não muda por ambiente) — mas, em modo `dry_run`, a chamada nunca
efetivamente sai para a API, então nem isso é estritamente necessário até
o dia de testar `live` (que, pela Seção 14.1, só acontece em produção).

**Não confirmado, honesto sobre o limite desta pesquisa**: se o
`idEcommerce`/canal também precisa estar "ativo"/vinculado a um token
válido do lado Olist para que a reserva de estoque automática do Olist
(Seção 2.5, "Pedido criado: estoque reservado") funcione corretamente, ou
se basta o pedido existir com aquele `ecommerce.id` preenchido — **a
confirmar na implementação**, com um pedido de teste real (a única forma
de verificar isto, já que não há sandbox — Seção 2.6).

### 14.8 Ordem segura de configuração no painel Olist

Sequência recomendada para o dono, cada passo depende do anterior:

1. **Criar/confirmar a integração "Ecommerce da Olist" / "Token API"**
   (Menu → Configurações → Aba E-commerce → Token API, ou Menu → Início →
   Loja de extensões — Seção 2.6/14.7) — só para obter o `idEcommerce` do
   canal. **O token gerado aqui não precisa ser copiado para nenhum lugar
   do site** (Seção 14.7) — só o id numérico do canal resultante.
   **Atenção**: como esta mesma tela (`Aba E-commerce`) é onde a Central de
   Ajuda também documenta configuração de notificações/webhook (achado da
   Seção 14.6), **conferir neste mesmo passo, com o suporte ou olhando o
   painel sem alterar nada, se a integração oficial Olist↔Woo já ocupa
   este mesmo espaço** — se ocupar, isto pode reforçar (não resolver
   sozinho) a cautela da Seção 14.6 sobre webhooks.
2. **Criar os dois "Aplicativos" OAuth v3** (Seção 14.3): **Persi Native
   Sync — Catálogo** (Produtos/Estoque/Listas de preço: Leitura) e **Persi
   Native Sync — Pedidos** (Pedidos de venda: Leitura + Incluir e editar,
   nunca Excluir). Guardar `client_id`/`client_secret` de cada um — vão
   para `OLIST_SYNC_CLIENT_ID`/`SECRET` e `OLIST_ORDERS_CLIENT_ID`/`SECRET`
   (nomes já registrados na Seção 14.3), cadastrados no hPanel pelo dono.
3. **Vínculo de produtos** (Seção 4) — só depois que o app Catálogo existir
   e suas credenciais estiverem configuradas: a implementação (rodada
   separada, já autorizada como só-leitura, Seção 14.6) faz a derivação do
   mapeamento SKU e a chamada em lote para obter `idProduto` por SKU.
4. **Webhooks — por último, e só quando as rotas existirem no
   staging/produção** — e, mesmo assim, só depois da confirmação do
   suporte exigida pela Seção 14.6. Não cadastrar nenhuma URL de webhook
   antes disso, mesmo que o código das rotas já esteja pronto (Seção 5.5).

## Apêndice — Papel atual do Woo pós-pedido → substituto nativo → fase

Levantamento read-only desta rodada (código do repo apenas), respondendo
"o que acontece depois que o pedido chega no Woo e que o Native Commerce
precisará substituir". Ver citações completas no corpo da investigação;
resumo tabulado abaixo.

| Função hoje (Woo) | Como funciona hoje | Substituto nativo | Fase |
| --- | --- | --- | --- |
| Criar pedido no Woo | `createPendingOrder` — `POST orders`, `status:"pending", set_paid:false` (`services/woocommerce/orders.ts:169-228`), disparado no submit do checkout | `orders`/`order_items` nativos (já existe, B.3-C) | Já existe (native) |
| Marcar pedido como pago | `markOrderAsPaid` — `PUT orders/{id}`, `status:"processing", set_paid:true` (`orders.ts:295-316`), chamado quando o provedor confirma pagamento (webhooks Inter/MP/PagBank, polling, ou o cron de reconciliação) | `apply_verified_payment_transition` (já existe, B.3-H) — transição atômica pagamento→pedido→estoque | Já existe (native) |
| Marcar pedido como falho/cancelado | `markOrderAsFailed` — `PUT orders/{id}`, `status:"failed"` ou `"cancelled"` (`orders.ts:320-332`) | Mesmo `apply_verified_payment_transition`/state machine de `orders.status` | Já existe (native) |
| Status "on-hold" | **Não é este app quem escreve** — um plugin/gateway legado do WordPress marca isso sozinho; o app só lê defensivamente (`orders.ts:350-355`) | N/A — não há equivalente nativo porque a causa raiz (plugin legado) não existe no native commerce | N/A |
| E-mails transacionais (novo pedido, processando, falhou, cancelado) | Disparados pelo **próprio WooCommerce** a partir da mudança de status (não há código de e-mail neste repo) | Design completo já existe e não está implementado: `docs/database/83-transactional-email-v1-design.md` | Fase 1 ou 2 (design já pronto, falta implementar) |
| Exportar pedido para Olist | Feito **pelo Woo/Olist hoje** (integração oficial confirmada pelo dono, Seção 8) — nenhum código deste repo participa | Outbox `site→Olist` (Seção 7 / doc 82) | **Fase 1 (canário)** |
| Baixa de estoque no Woo | Não é este app quem baixa — é o próprio WooCommerce, no status que a loja tiver configurado (não verificável neste repo) | Sync Olist→site já cobre isso (Seção 5) — o site nunca baixa estoque em nenhum ERP/Woo | N/A (Olist já é quem baixa, Woo só reflete) |
| Onde a equipe opera pedidos hoje | Sem UI de pedidos neste app (`app/admin` só tem `pim`/`products`); tudo aponta para o painel Woo/WordPress nativo, não confirmável 100% pelo repo | Nenhum substituto nativo existe ou está planejado nesta rodada | **A CONFIRMAR COM O DONO** |
| Cupom | Aplicado via Woo Store API (`services/woocommerce/cart.ts:594-608`), enviado ao pedido como `coupon_lines` (`orders.ts:196-198`) | Não existe ainda no native commerce (Gate 3 não trata cupom) | Gap separado, não coberto por Gate 3 nem por este documento |
| Frete | Enviado como `shipping_lines` (`orders.ts:209-219`) | `shipments`/Melhor Envio já modelados no schema nativo (Seção 3); native checkout hoje só suporta `shippingRequired:false` (Gate 3, gap conhecido) | Gap separado, já documentado no design do Gate 3 |
| CPF/CNPJ | **Reinvestigado (Seção 7.1)**: `createPendingOrder` continua sem enviar CPF/CNPJ no payload de criação. O CPF do cliente logado é salvo uma vez no perfil (`billing_cpf`, user-meta do WordPress, `CustomerWorkspaceService.php:42,54`) e aparece depois no pedido Woo (`getOrderConfirmationDetails` lê `billing.cpf` de volta) — o mecanismo exato que copia um para o outro **não está em nenhum código deste repositório**, provavelmente um plugin de campos brasileiros no WordPress ao vivo, não confirmável por leitura de código | `checkoutPii`/`nativeCheckoutPii` já capturam e criptografam o documento fiscal para **todo** checkout nativo, incluindo convidados (Seção 7.1) — falta só propagar para o payload de export ao Olist, trabalho novo do outbox | **Fase 1 (bloqueador do export de pedido, Seção 7.1)** |
| Inscrição Estadual (IE) / CNPJ | **Não encontrado em nenhum lugar do código** — nem no perfil, nem no checkout, nem no pedido | Não modelado ainda | **A CONFIRMAR COM O DONO** se é necessário (Seção 12, item 8) |

Nota atualizada (substitui a nota anterior desta seção, que presumia CPF/
CNPJ irrelevante para a Fase 1): como o export de pedido site→Olist
**precisa** enviar `consumidorFinal.cpfCnpj` (Seção 2.3), e o caminho atual
do Woo para esse dado depende de um perfil salvo + um mecanismo não
verificável neste repositório, a exportação nativa via
`checkoutPii`/`nativeCheckoutPii` (que já captura o documento no checkout,
para todo pedido, não só clientes com perfil salvo) passa a ser **mais
completa que o caminho legado**, não apenas um substituto equivalente.
