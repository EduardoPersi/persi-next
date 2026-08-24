# Estratégia de migração — WooCommerce para Persi Database

## Princípios

- WooCommerce permanece autoridade até cada cutover aprovado.
- Importações entram em staging e só são promovidas após validação.
- Cada etapa é repetível, idempotente, observável e reversível.
- IDs internos nunca são derivados de IDs Woo; mappings preservam legado.
- Read cutover e write cutover são decisões separadas.
- Nenhuma etapa abaixo é executada na Fase B.

## Fases

### 1. Schema novo

Aplicar migrations em local e depois staging. Criar roles, constraints, índices,
RLS, inbox/outbox e testes. Sem ligação com rotas públicas.

Gate: banco vazio reproduzível, testes verdes, restore ensaiado e produção não
configurada nos scripts destrutivos.

### 2. Importação inicial Woo -> staging

Extrair lotes paginados com run ID, source timestamp e checksums para tabelas
`migration_staging_*` isoladas. Armazenar payload bruto somente quando necessário,
com retenção curta e acesso restrito. Não promover durante a extração.

Detectar: SKU/GTIN/slug duplicados, produto sem SKU, variação órfã, marca ausente,
categoria inválida, encoding, valores monetários, imagens ausentes e medidas não
parseadas. Todo produto simples gera uma variant candidata.

### 3. Validação e promoção

Normalizar, produzir relatório e bloquear itens críticos. Promoção para tabelas
canônicas ocorre em transação/lotes idempotentes, cria `external_mappings` e
registra versão do transformador. Registros inválidos não são silenciosamente
descartados.

### 4. Sincronização incremental

Enquanto Woo é autoridade, capturar `updated_at`/webhook com cursor e varredura
periódica de segurança. Eventos são deduplicados na inbox. Deletes viram estado
arquivado, não remoção imediata. Watermark inclui sobreposição temporal para não
perder eventos; upsert usa source version e mapping.

### 5. Shadow reads

```text
request -> Woo (oficial) -> resposta ao usuário
             +-> PostgreSQL shadow -> comparador -> métricas/diferenças
```

Shadow read é amostrado, possui timeout menor que o caminho oficial e nunca
atrasa/muda a resposta. Comparação normaliza ordem e formatos. Não registrar PII.
Escopos graduais: produto/categoria/atributos; depois preço/estoque apenas para
comparação; pedidos somente em job restrito.

### 6. Read cutover

Por domínio/rota e feature flag com rollback instantâneo. Começar por catálogo
público de baixo risco. Preço exibido e estoque exigem reconciliação recente;
carrinho/checkout continuam Woo. Monitorar miss, latência, cache e SEO.

### 7. Write cutover

Exige ownership explícito. Não fazer dual write ingênuo em request. A escrita
canônica ocorre numa base; outbox replica para o legado de forma idempotente.
Sequência recomendada: conteúdo de catálogo, depois preço/estoque com ERP, e por
último carrinho/pedido/pagamento. Este último exige migração das tentativas atuais,
teste de concorrência e plano financeiro aprovado.

### 8. Janela de rollback

Woo permanece operacional e sincronizado durante janela definida por domínio.
Rollback de leitura retorna feature flag para Woo. Rollback de escrita não é
simples troca: para evitar perda, drenar outbox, reconciliar alterações e declarar
qual sistema volta a ser autoridade antes de reabrir writes.

### 9. Desativação posterior do Woo

Somente após janela, reconciliação 100%, obrigações fiscais, SEO, feeds, ERP,
frete, conta, pagamentos e suporte operacional aprovados. Preservar export
imutável e mappings. Não faz parte da V1 inicial.

## Reconciliation reports

Cada relatório guarda run, source snapshots/time, transform version e contagens:
`total`, `matched`, `different`, `missing_source`, `missing_target`, `invalid`.

| Relatório | Chave | Comparações mínimas |
| --- | --- | --- |
| Produtos | Woo product ID/mapping | slug, nome, status, marca, categorias |
| Variants | Woo variation ID/SKU | SKU, GTIN, atributos, parent |
| Preços | variant + lista | minor units, moeda, vigência |
| Estoque | variant + location mapping | on_hand/reserved/available e timestamp |
| Pedidos | Woo order ID | number, customer mapping, itens, totais, status |

Diferenças financeiras e de estoque nunca são autoaceitas por tolerância. Texto
pode usar normalização documentada. Relatórios devem permitir drill-down sem
expor documentos pessoais.

## Mappings e idempotência

- Unique `(system, entity_type, external_id)`.
- SKU e email não substituem mapping; são sinais de match sujeitos a conflito.
- Toda importação possui `source_record_id + source_version/checksum` único.
- Reprocessar o mesmo lote produz o mesmo estado, sem duplicar histórico.
- Woo order, product, variation e customer IDs são preservados.

## Guardas operacionais

- Scripts destrutivos exigem `PERSI_DB_ENV=local` e validam host/database/project
  ref contra allowlist local; não aceitam apenas `NODE_ENV`.
- Staging exige confirmação explícita e role própria; production nunca é default.
- Log mostra host sanitizado/ref e ambiente, nunca senha/string completa.
- Importador é read-only no Woo e sem side effects na primeira execução.
- Cada batch tem limite, timeout, checkpoint, retry e botão/flag de interrupção.

## Ordem de migrations planejada

```text
0001_core_extensions
0002_catalog
0003_pim
0004_pricing
0005_inventory
0006_customers_identity
0007_cart_orders
0008_payments_shipping_promotions
0009_seo_search
0010_integrations_outbox_audit
0011_rls_roles
0012_migration_staging
```

Nomes reais usarão timestamps do Supabase CLI. Extensões (`pg_trgm`, `unaccent`,
eventual UUID support) serão verificadas no ambiente e criadas em schema seguro.

## Critérios para cada cutover

- reconciliação com limiar aprovado e zero divergência financeira inexplicada;
- testes de carga/concorrência e observabilidade ativa;
- cache e SEO equivalentes;
- suporte e rollback ensaiados;
- backup/restauração validados;
- aprovação humana explícita e janela operacional.
