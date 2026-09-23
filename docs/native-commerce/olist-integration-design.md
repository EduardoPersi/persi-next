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

| Webhook | Payload (campos confirmados) |
| --- | --- |
| Atualização de Estoque | `dados.idProduto`, `dados.sku`, `dados.skuMapeamento`, `dados.saldo`, `dados.tipoEstoque` (`F`=físico, `D`=disponível) |
| Envio de Preço de Produtos | `dados.idMapeamento`, `dados.skuMapeamento`, `dados.preco`, `dados.precoPromocional` |
| Atualização de Situação de Pedido | `dados.idPedidoEcommerce`, `dados.idVendaTiny`, `dados.situacao`, `dados.descricaoSituacao` |
| Envio de Produtos, Envio de Nota Fiscal, Envio de Código de Rastreio, Cotação de Fretes | existem, payload não detalhado nesta pesquisa (não necessários para a Fase 1) |

Confirmado: um retorno diferente de HTTP 200 faz o Olist **reenviar** o
webhook (contagem de tentativas/backoff exatos **A CONFIRMAR** — não
publicados). Decimais usam `.` como separador.

### 2.3 Campo de referência externa / idempotência no pedido

`POST` de pedido de venda aceita **`numeroPedidoEcommerce`** (string,
identificador externo) — é o campo natural para carregar o `orders.id`/
`order_number` do Persi, e é exatamente o campo que o webhook de situação
de pedido devolve (`idPedidoEcommerce`) para correlacionar de volta.
**A CONFIRMAR_OLIST**: se esse campo também funciona como chave de
idempotência no servidor (rejeita/retorna o mesmo pedido em um reenvio) ou
é apenas um campo de referência sem enforcement — Seção 7/82 §7 já tratam
essa incerteza com duas camadas de idempotência independentes do
comportamento do Olist.

Outros campos confirmados no payload de criação de pedido: `consumidorFinal.cpfCnpj`,
`valorFrete`, `valorDesconto` (valor plano — **não há campo de código de
cupom nomeado confirmado**, A CONFIRMAR_OLIST), `itens[].produto.id`,
`itens[].quantidade`, `itens[].valorUnitario`, `situacao` (enum 0–9).

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
  (leitura/escrita) dependendo do plano contratado — **A CONFIRMAR COM O
  DONO** qual plano a Persi tem.
- **Nenhum ambiente de sandbox/teste foi encontrado** na documentação
  pública. Testes de integração precisarão ser feitos contra a conta real
  (com cuidado: qualquer escrita cria um produto/pedido real).
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

### 5.2 Incremental (webhook)

Uma nova rota, seguindo o padrão de todo webhook já existente neste
projeto (`app/api/webhooks/{inter,mercadopago,pagbank}/route.ts`):
`app/api/webhooks/olist/estoque/route.ts` (e um par `.../preco/route.ts`
para a Fase 1, se o preço também vier por webhook — Seção 5.4). Cada rota:

1. Valida a origem/assinatura do webhook (**A CONFIRMAR_OLIST**: o Olist
   assina o payload? Se não houver assinatura, validar por IP de origem
   documentado pelo Olist, se existir, e tratar o corpo como não confiável
   até prova em contrário — mesma cautela já aplicada aos webhooks de
   pagamento).
2. Resolve `idProduto`/`sku` → `product_variant_id` via `external_mappings
   (system='olist')`; se não mapeado, grava em `integration_inbox` como
   evento não processável e retorna 200 (não deixar o Olist reenviar
   infinitamente um produto que nunca vai mapear) — mesmo padrão de
   `integration_inbox` já usado para o sync de catálogo do Woo.
3. Chama `adjust_inventory` (ou o `preço`-equivalente) via
   `withPersiRole("persi_worker", ...)`, usando o id do evento do webhook
   (ou `idProduto + saldo + timestamp` se o Olist não expuser um id de
   evento estável) como `source_reference` para deduplicar automaticamente
   por reenvio.
4. Responde 200 sempre que o payload foi processado (mesmo se o resultado
   foi "produto não mapeado, ignorado") — só responde erro por
   indisponibilidade real do banco, para não acionar o reenvio do Olist
   por um caso que reenviar não resolve.

### 5.3 Reconciliação periódica

Job cron (padrão `expire-pending-payments`, Seção 3), rodando a cada N
minutos: para uma fatia dos produtos mapeados (não todos de uma vez, por
causa do rate limit por conta — Seção 2.6), busca o estoque/preço atual
via API REST (não espera pelo webhook) e compara com o que está em
`inventory_levels`/`prices`. Detecta:

- Webhook perdido (site desatualizado em relação ao Olist há mais que X
  minutos) — aplica a correção via o mesmo `adjust_inventory`.
- Divergência persistente (a mesma comparação falha repetidamente) — não
  auto-corrige silenciosamente uma segunda vez sem alertar; loga como
  evento de observabilidade (Seção 9) e segue para o próximo lote.

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

1. O worker (5.2/5.3) **não trava o processamento do lote inteiro** — captura
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

### 6.3 Cancelamento e estorno pós-pagamento (requisito do canário)

**Política confirmada pelo dono**: se um pedido nativo já pago não pode
ser atendido por falta real de estoque no Olist (Seção 6.2), o pedido é
**cancelado e o pagamento estornado** — não há tentativa de substituição
automática nem contato assíncrono como alternativa a isto (pode
complementar, mas o cancelamento+estorno é o requisito mínimo).

**O que já existe, reaproveitável**:

- `orders.status` já permite a transição `confirmed → cancelled`
  (`CURRENT_ORDER_STATE_MACHINE`, ver doc 82 §3).
- `createNativeRefund`/`transitionNativeRefund`
  (`lib/db/nativePayment.ts:98,136`) já modelam o **estado** de um
  reembolso (`refund_status`: `requested → processing → completed |
  failed | cancelled`) na ledger nativa — dual-granted `persi_app`/
  `persi_worker`, já prontos para registrar que um reembolso foi pedido e
  seu resultado.

**O que NÃO existe — gap real, pré-existente, que este requisito torna
bloqueador (antes era `OPERATIONAL_FOLLOWUP` adiado)**:

1. **Nenhum adapter de pagamento chama a API de estorno do provedor.**
   Confirmado por grep: `services/payments/{inter,mercadopago,pagbank}/*`
   só **reconhecem** um status `refunded` quando o provedor já reporta
   isso (webhook/consulta) — nenhum código **inicia** um estorno.
   `docs/database/76-native-mercadopago-gateway-reanchoring.md` §9 já
   documenta isto explicitamente para o Mercado Pago ("no refund
   implementation, no existing capability to wire"); o mesmo vale, por
   inspeção, para os adapters do Inter e do PagBank. Isto precisa ser
   construído para os três, um requisito novo que este design de Olist
   está expondo, não uma consequência da integração Olist em si.
   **A CONFIRMAR** (fora do escopo de pesquisa desta rodada, que foi só
   sobre a API do Olist): a documentação oficial de cada provedor —
   Banco Inter (devolução de Pix; boleto normalmente não é "estornado", é
   deixado expirar ou baixado manualmente), Mercado Pago (endpoint de
   reembolso total/parcial), PagBank (reembolso de cartão/Apple Pay/
   Google Pay) — prazos, se aceitam estorno parcial, e taxas envolvidas.
2. **`order.cancel` (Olist) continua não resolvido** — doc 82 §4 já
   registrava isto como gap adiável (`POST_V1_OPERATIONAL_GAP`). Com a
   política de cancelamento agora obrigatória, ele deixa de ser adiável
   **sempre que o pedido já tiver sido exportado ao Olist antes do
   cancelamento** (cenário plausível: export acontece na aprovação do
   pagamento — Seção 7 — e a baixa de estoque no Olist também acontece na
   aprovação — Seção 2.4 — então o pedido pode já existir no Olist no
   momento em que a divergência de estoque é detectada). Sem um jeito de
   avisar o Olist, o pedido cancelado no site ficaria "fantasma" do lado
   do Olist. **A CONFIRMAR_OLIST**: se a API de pedidos do Olist aceita
   cancelamento pós-criação (a lista de endpoints, Seção 2.1, não
   confirmou um "cancelar pedido" explícito — só "atualizar situação",
   que talvez aceite `situacao=2` "Cancelado").

**Runbook proposto** (sequência, não código):

1. Divergência de estoque detectada (Seção 6.2) aponta uma reserva já
   confirmada como pedido pago sem estoque real correspondente.
2. Transição `orders.status: confirmed → cancelled` (mecanismo já
   existente).
3. `createNativeRefund` registra a intenção de estorno (mecanismo já
   existente) — valor total do pedido, motivo `stock_unavailable_after_sync`.
4. **[A CONSTRUIR]** Adapter do provedor correspondente executa o estorno
   real via API do provedor; `transitionNativeRefund` grava o resultado
   (`completed`/`failed`).
5. **[A CONSTRUIR]** Se o pedido já tinha sido exportado ao Olist
   (existe `external_mappings system='olist' entity_type='order'` para
   ele), um evento `order.cancel` é enfileirado no mesmo outbox (Seção 7)
   avisando o Olist.
6. Cliente é notificado do cancelamento e do estorno (depende de
   `docs/database/83-transactional-email-v1-design.md`, hoje design-only
   — Fase 2 original, mas o e-mail de cancelamento especificamente também
   vira dependência do canário por causa desta política).
7. Todo o fluxo gera evento de observabilidade (Seção 9) sem PII —
   identificadores do pedido/reembolso apenas.

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
- `order.cancel` pós-confirmação **deixou de ser um gap adiável** — a
  política de oversell do dono (Seção 6.3) exige cancelamento mesmo após
  export, então este evento entra no escopo da Fase 1 (Seção 11), não mais
  `POST_V1_OPERATIONAL_GAP`.

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
| Olist fora do ar (5xx/timeout na API) | erro de rede/HTTP no worker | backoff exponencial (mesmo esquema de 82 §8); reconciliação periódica (5.3) cobre o período fora do ar assim que o Olist volta; nenhuma venda é bloqueada — o site continua vendendo com o último saldo conhecido, sujeito à margem de segurança (Seção 6.1) |
| Webhook perdido | reconciliação (5.3) encontra divergência sem evento correspondente recebido | corrige o saldo via a mesma reconciliação; loga como `stock_sync_webhook_gap_detected` |
| Divergência de estoque (Olist diz menos do que o site tem reservado) | `adjust_inventory` retorna `23514` | ver política de oversell, Seção 6.2 |
| `401`/`403` do Olist | resposta da API | nunca retenta no mesmo schedule de falha transitória — alerta imediato de credencial expirada/inválida (mesma regra de 82 §8) |
| Produto Olist sem par no site | webhook/reconciliação não encontra `external_mappings` | grava em `integration_inbox` como não processável, não alerta a cada evento (seria ruído para os SKUs legitimamente fora do mapeamento — Seção 4) |

## 11. Fases

**Fase 1 (canário)** — bloqueadora para o primeiro pedido nativo real:

- Derivação/verificação do mapeamento SKU (Seção 4, agora por query direta,
  sem chamada ao Olist para descobrir correspondência).
- Sync Olist→site de catálogo/preço/estoque, webhook + reconciliação
  (Seção 5).
- Export de pedido pago site→Olist via outbox (Seção 7, = 82 completo),
  **incluindo `order.cancel`** (deixou de ser Fase 2 — Seção 6.3/7).
- **Cancelamento + estorno pós-pagamento** (Seção 6.3) — inclui construir a
  chamada real de estorno nos três adapters de pagamento (Inter/Mercado
  Pago/PagBank), hoje inexistente para qualquer um dos três.
- Runbook mínimo de falha (Seção 10).

**Fase 2 (pós-canário)** — não bloqueia o primeiro pedido:

- Status operacional/logístico do pedido (webhook "Atualização de Situação
  de Pedido") refletido de volta no site (rastreio ao cliente).
- Nota fiscal (emissão, XML, DANFE) — hoje já é responsabilidade do Woo/
  Olist; migrar apenas quando o volume canário justificar.
- Rastreio de entrega ao cliente via native commerce.
- Notificações transacionais nativas ligadas a esses eventos (depende
  também de `docs/database/83-transactional-email-v1-design.md`, hoje
  design-only).

## 12. O que depende do dono

**Resolvido nesta rodada** (mantido aqui só como registro, nada a fazer):
qual `price_list` recebe o preço Olist (única — Seção 5.4); margem de
segurança (0 — Seção 6.1); política de oversell (cancelar — Seção 6.2/6.3);
tratamento de kit (Seção 4); timing de baixa de estoque no Olist (na
aprovação — Seção 2.4); direção da integração Olist↔Woo (Olist chama o Woo
— Seção 8); mapeamento SKU (Woo SKU = Olist SKU, derivação direta — Seção 4).

**Ainda em aberto**:

1. Acesso real ao Olist: criar um "Aplicativo" OAuth v3 dedicado ao native
   commerce (nunca reaproveitar a credencial que a integração Olist↔Woo já
   usa — Seção 8) — **plano/permissões a confirmar no painel do Olist**
   pelo dono (o dono já confirmou que isso precisa ser verificado, ainda
   não tem a resposta).
2. Confirmar o plano contratado (define o rate limit real — Seção 2.6).
3. Não há sandbox Olist encontrado — confirmar se o dono concorda em
   testar contra a conta real com cuidado, ou se existe algum ambiente de
   teste não documentado publicamente que a Persi já tenha acesso.
4. Confirmar se existem produtos kit/composição ativos no catálogo hoje
   (a Seção 4/6.3 já cobre como tratá-los quando existirem).
5. Confirmar se há campo de código de cupom nomeado na API de pedido do
   Olist, ou se descontos de cupom precisam virar `valorDesconto` (valor
   plano) no export (Seção 2.3, Apêndice item "Cupom" da tabela Woo).
6. **Novo, decorrente da política de cancelamento (Seção 6.3)**: para cada
   provedor de pagamento (Banco Inter, Mercado Pago, PagBank), confirmar
   na documentação oficial de cada um: existe endpoint de estorno
   total/parcial, prazo para executar, e alguma taxa envolvida. Pix/cartão
   têm estorno real na maioria dos bancos/adquirentes; boleto normalmente
   não é "estornável" (é apenas baixado/expirado) — como tratar um
   cancelamento pós-pagamento de boleto Inter especificamente é uma
   decisão pendente.
7. **Novo, decorrente da Seção 6.3**: confirmar se a API de pedidos do
   Olist aceita cancelamento pós-criação (`situacao=2`?) — nenhum endpoint
   "cancelar pedido" explícito apareceu na pesquisa desta rodada (Seção
   2.1), só "atualizar situação".
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
| Rota(s) de webhook Olist (estoque/preço) | Médio | Sim |
| Job de reconciliação periódica (Seção 5.3) | Médio | Sim, reaproveita padrão de cron existente |
| Wrapper `SECURITY DEFINER` + grant para `adjust_inventory`/preço via `persi_worker` | Pequeno (migration aditiva) | Sim |
| Cálculo de margem de segurança em leitura (Seção 6.1) | Pequeno | Sim, mas só faz sentido depois que o Gate 3 tiver um ponto de checagem de estoque no carrinho (hoje não existe — gap separado, fora deste documento) |
| Decisão de qual `price_list` recebe o preço Olist (Seção 5.4) | Depende do dono, não de código | N/A |

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
