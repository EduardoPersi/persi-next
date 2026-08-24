# Integração Olist — autoridade, direção e extração

## Situação atual

O WooCommerce é a autoridade operacional atual. A documentação histórica cita
Bling; a árvore local contém `wordpress-plugin/persi-catalog-engine/` 1.2.1 não
rastreado, com OAuth Olist, consulta por SKU, sincronização de GTIN, cache,
retry/circuit breaker, dry-run, auditoria e descoberta PIM. Não há integração
versionada completa de pedidos/estoque com Olist no Next.js.

Este design não ativa Olist nem presume que o contrato/plano atual suporte todos
os campos. Antes da implementação, validar API, rate limits, webhooks, IDs,
semântica de estoque e credenciais na documentação/conta oficial.

## Matriz de autoridade futura proposta

Durante migração, “Persi” abaixo só vira autoridade após cutover do domínio.

| Dado | Persi Database | Olist | Provider/Woo atual | Autoridade proposta |
| --- | --- | --- | --- | --- |
| ID interno | cria/preserva | ID externo | IDs Woo | Persi |
| SKU | valida e publica | recebe/mapeia | Woo atual | Persi após catalog cutover |
| Nome/descrição | PIM editorial | recebe quando necessário | WP atual | Persi após content cutover |
| Marca/categoria/atributos | PIM canônico | fonte candidata/recebe subset | WP/Woo atual | Persi, com revisão |
| EAN/GTIN | valida e mantém canônico | candidato/fonte operacional | Woo atual | Persi após reconciliação; conflito é manual |
| Preço de storefront | listas/regras | pode receber/fornecer sinal | Woo atual | Persi Pricing após cutover |
| Estoque físico | ledger/projeção | ERP operacional | Woo atual | decisão humana: Olist para físico; Persi para reservas/available |
| Pedido | cria snapshot | recebe fulfillment/fiscal | Woo atual | Persi após order write cutover |
| Status financeiro | registra | não governa pagamento | Inter/PagBank | PSP, mapeado por Persi |
| Status logístico/fiscal | consolida | pode governar operação | Woo/plugins atuais | Olist para evento operacional; Persi agrega |
| Cliente | mínimo da venda | recebe subset necessário | WP/Woo atual | Persi; compartilhamento minimizado |

Ponto de decisão humana: confirmar se Olist será autoridade de `on_hand` por
local. Recomendação: Olist governa saldo físico/ERP; Persi governa reservas do
e-commerce e calcula `available`, conciliando inbound Olist sem sobrescrever
reservas. Não implementar até validar granularidade de depósito e timing.

## Direções para evitar ciclo

- Catalog/PIM: Persi -> Olist após cutover; antes, Woo -> staging/Persi. Dados
  Olist podem gerar candidatos, nunca sobrescrever editorial aprovado.
- GTIN legado: Olist -> candidato -> validação/conflito -> Persi; depois Persi
  publica o valor aprovado. Nunca ecoar o mesmo evento como nova alteração.
- Estoque: Olist -> `on_hand` por evento/snapshot; Persi -> Olist apenas pedidos
  ou movimentos acordados, não o mesmo saldo agregado de volta.
- Orders: Persi -> Olist uma vez via outbox/idempotency; status operacional
  Olist -> Persi via inbox/polling.
- Payments: PSP -> Persi. Não aceitar status financeiro do ERP como autoridade.

Cada mensagem carrega source system, external ID, source version/timestamp,
correlation ID e idempotency key. `external_mappings` impede match recorrente por
texto/SKU depois que o vínculo foi aprovado.

## Componentes de integração

- `external_mappings`: sistema, entity type, internal/external IDs, external SKU,
  status e last synced.
- `integration_jobs`: type, direction, entity, dedup key, cursor, status,
  attempts, available/started/finished timestamps.
- `integration_errors`: código sanitizado, stage, retryability e correlation ID;
  payload sensível fica fora.
- `webhook_events`: inbox quando Olist oferecer webhook confiável.
- `outbox_events`: pedidos/catálogo/estoque a publicar depois do commit.

Workers usam batch pequeno, backoff com jitter, rate-limit awareness, circuit
breaker e `SKIP LOCKED`. Reprocessamento é seguro; erro parcial não avança cursor
antes de persistir todos os resultados do lote.

## Plugin não rastreado: recomendação

### Potencialmente reutilizável como regra pura

- validação/normalização GTIN;
- parser de medidas compostas;
- normalização e aliases de atributos;
- regras de descoberta, classificação de conflito e casos de teste;
- conceitos de dry-run, run report, retry e circuit breaker.

### Deve ser reescrito como adaptador

- `$wpdb`, tabelas MySQL e `wp_options`;
- `WC_Product`, hooks/admin pages e Action Scheduler;
- armazenamento OAuth/token;
- cache de snapshots e escrita direta no Woo;
- apresentação e autorização WordPress.

### Processo de extração

1. Não copiar automaticamente.
2. Versionar/revisar o plugin numa tarefa própria sem misturar com migrations.
3. Criar fixtures anonimizadas de medidas, GTIN e respostas Olist.
4. Extrair funções puras TypeScript com paridade testada.
5. Implementar uma porta `ErpCatalogProvider`; Olist é um adaptador.
6. Rodar apenas dry-run/staging e comparar relatórios antes de qualquer write.

## Reconciliação e observabilidade

Relatórios por domínio mostram total/matched/different/missing/invalid, lag do
cursor, backlog, retries e rate limits. Alertas: mapping ambíguo, SKU/GTIN
duplicado, saldo negativo, pedido sem confirmação, sequência de 401/429/5xx e
outbox envelhecida. Logs não contêm tokens, cliente, documento ou payload bruto.

## Rollback

Desabilitar worker/feature flag, drenar ou congelar leases e manter eventos
pendentes. Não apagar mappings/jobs. Se um write remoto ocorreu, reconciliar e
compensar pela regra do domínio; rollback de código não desfaz operação ERP.
