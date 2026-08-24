# Shadow read do catálogo — Fase F.1

## Resultado executivo

WooCommerce continua a fonte oficial. O shadow PostgreSQL é server-only, opt-in, amostrado
e não participa da resposta enviada ao usuário. A comparação offline verificou os 3.080
produtos e encontrou zero divergência Critical, High, Medium ou Low nos campos cobertos.
Produto, categoria e marca foram aprovados; busca não foi aprovada por diferenças de
relevância e ausência da expansão de sinônimos do Next na consulta SQL.

Nenhum cutover foi executado.

## Contratos Woo atuais

| Área | Funções principais | Semântica/cache |
| --- | --- | --- |
| Home | `getProducts`, categorias e marcas | recentes por `orderby=date desc`; revalidate Store API |
| PDP | `getProductBySlug`, related, brand e navigation | Store API por slug; variações em chamada separada |
| Categoria | `getAvailabilityFirstProductsPage`, filters | paginação; disponíveis/on-backorder antes de out-of-stock |
| Marca | `getProductsByBrand` | filtro de taxonomy Woo e paginação |
| Busca | `searchWooCommerceProducts` | múltiplos termos/taxonomias, ranking local e sinônimos |
| Menu | categorias/marcas | `unstable_cache`, revalidate 300 s |
| Recomendações | REST/Store API | caches de 120 s conforme serviço |

O contrato visual permanece `types/product.ts`. Nenhum componente, URL, SEO, metadata,
schema.org, sitemap, breadcrumb ou checkout foi alterado.

Os sinônimos continuam em `lib/constants/searchSynonyms.ts`, incluindo `cano/tubo`,
`caixa d água/reservatório`, `veda rosca/teflon`, `bomba sapo/submersa` e variações de
torneira boia. Eles ainda não foram migrados para SQL.

## Domain/DAL

`CatalogProduct` mantém preço como `bigint` em minor units e separa produto, preço,
inventário, marca, categorias, imagens e atributos. Os adapters são:

- Woo `Product` → `CatalogProduct` para comparação do contrato atual;
- PostgreSQL aggregate → `CatalogProduct`, sem expor row Drizzle à UI;
- lookup por slug, SKU normalizado e Woo external ID;
- páginas por categoria/marca, com paginação, ordenação e disponibilidade primeiro;
- busca shadow por SKU, GTIN e nome.

A conexão usa o módulo `server-only`, Drizzle/Postgres.js e `DATABASE_URL`. Browser e Data
API/Supabase client não acessam o catálogo.

## Flags e fail-safe

```text
CATALOG_DATA_SOURCE=woocommerce
CATALOG_SHADOW_READ_ENABLED=false
CATALOG_SHADOW_SAMPLE_RATE=0
CATALOG_SHADOW_TIMEOUT_MS=500
```

Esses são os defaults. Valores inválidos de data source voltam para Woo; sampling é limitado
a 0..1 e timeout a 50..2.000 ms. A PDP agenda a comparação somente após obter o produto
oficial. Falha/timeout PostgreSQL gera evento estruturado sanitizado e não muda a resposta.

O log contém apenas timestamp, tipo, identificador público, durações, match, severidade e
campos divergentes. Não contém segredo, cookie, token ou PII.

## Comparação integral e drift

Execução em 2026-08-24 contra `persi-staging`:

- produtos comparados: 3.080;
- Critical/High/Medium/Low: 0/0/0/0;
- preço regular/promocional, SKU, slug e produto ausente: zero divergência;
- estoque, marca e categorias: zero divergência;
- GTIN, mídia e PIM: zero divergência;
- descrição normalizada: zero divergência.

Cinco Woo IDs tinham `date_modified_gmt` posterior ao término da E.6: 15688, 15222, 9043,
5652 e 5472. Nenhuma mudança atingiu os campos comparados, portanto drift funcional
observado foi zero. A ausência de sincronização incremental continua sendo risco: uma
alteração futura de preço/estoque no Woo ficará desatualizada no snapshot até existir sync.

## Categoria, marca e busca

Foram amostradas categorias pequenas, médias e grandes e cinco marcas distribuídas por
cardinalidade. Membership, preço, estoque, identidade e paginação passaram. A auditoria
integral cobriu todas as relações, além das amostras de latência.

Corpus de busca: SKU, GTIN, nome completo/parcial, marca, bitola, medida e sinônimos. Houve
equivalência completa em `PA016045`, `tubo pvc`, `tigre`, `20 mm`, `fita veda rosca` e
`massa corrida`. A interseção top-20 foi 14 para `disjuntor`, 1 para `3/4` e 11 para `cano`.
Consultas sinônimas sem expansão (`caixa d agua`, `bomba sapo`) retornaram zero nos dois
endpoints simples, mas o fluxo oficial Next aplica lógica adicional. Por isso a busca PG
não está funcionalmente aprovada.

## Performance

| Operação | Woo p50 | Woo p95 | PostgreSQL p50 | PostgreSQL p95 | Amostras |
| --- | ---: | ---: | ---: | ---: | ---: |
| Product by slug | 264,5 ms | 364,3 ms | 19,1 ms | 43,8 ms | 30 |
| SKU lookup | 325,9 ms | 384,0 ms | 20,3 ms | 45,0 ms | 30 |
| Category listing | 336,6 ms | 527,8 ms | 21,5 ms | 122,5 ms | 5 |
| Brand listing | 292,7 ms | 421,2 ms | 19,1 ms | 30,9 ms | 5 |
| Search | 318,4 ms | 567,0 ms | 26,2 ms | 281,3 ms | 12 |

Houve 62 requests Woo e um retry transitório. O aggregate PDP exige uma query; SKU uma;
category/brand/search usam duas (count + página), sem N+1.

## EXPLAIN ANALYZE

| Consulta | Plano principal | Execução servidor |
| --- | --- | ---: |
| Product by slug | Limit → Index Scan | 0,135 ms |
| SKU | Limit → Index Scan | 0,038 ms |
| Categoria | Nested Loop + Index/Index Only Scan | 0,129 ms |
| Busca por nome | Bitmap Heap/Index Scan | 2,575 ms |

Não foi demonstrada necessidade de migration ou índice novo. `pg_trgm` e os índices atuais
foram usados. FTS/unaccent e ranking composto devem ser desenhados junto da equivalência de
sinônimos, não adicionados por especulação.

## Dados ainda exclusivos ou incompletos

O PostgreSQL V1 não possui equivalência completa para rating/review count, popularidade,
featured, purchasable/backorders, tags, free-shipping metadata, HTML comercial calculado,
imagens administrativas de marca/categoria e toda a semântica de filtros Store API. Esses
campos não bloquearam o aggregate reconciliado, mas bloqueiam cutover geral da leitura.

Inventário no PostgreSQL continua snapshot, não autoridade. O próximo passo deve ser sync
incremental idempotente Woo → PostgreSQL, seguido de equivalência da busca/ranking e dos
metadados ausentes. Não implementar dual write ingênuo.

## Riscos e recomendação

- snapshot envelhece após mudanças operacionais no Woo;
- busca não reproduz ainda relevância/sinônimos;
- alguns contratos de merchandising e filtros ainda vivem somente no Woo;
- execução assíncrona sem fila é best-effort em runtimes serverless;
- shadow deve continuar OFF em produção até autorização e estratégia de observabilidade.

Produto, categoria e marca estão prontos para evolução controlada, mas o PostgreSQL ainda
não está pronto para substituir toda a leitura Woo. Recomenda-se uma fase de sync incremental
e busca equivalente antes de qualquer canary/cutover.

## Atualização F.2

A F.2 adicionou réplica incremental com inbox/checkpoint persistentes e um read model de
busca indexado. Após reconciliar dois snapshots de estoque alterados no Woo, a comparação
integral voltou a 3.080/3.080 com Critical/High/Medium/Low = 0/0/0/0. Woo permanece oficial,
shadow continua OFF por padrão e nenhum canary/cutover foi executado. Detalhes em
`docs/database/18-incremental-sync-search-parity.md`.
# Atualização F.3

A comparação integral foi repetida após a expansão semântica: 3.080/3.080, Critical/High/Medium/Low 0/0/0/0. Consulte `19-store-api-parity-matrix.md` e `20-canary-readiness.md`. Shadow/canary continuam desligados.
