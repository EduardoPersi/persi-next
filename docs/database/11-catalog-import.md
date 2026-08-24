# Importação controlada do catálogo Woo → persi-staging

## Estado

## Performance Gate — E.4

Uma nova passagem no-op instrumentou 100 produtos por fase e comparou concorrência 1, 2 e
4. O p95 de 5.060 ms da E.3 não se repetiu: os p95 ficaram em 651, 615 e 683 ms. Os casos
mais lentos se concentraram em mídia e overhead transacional/rede. Não houve timeout,
retry, erro, alteração de UUID ou write físico nas 300 transações.

| Concorrência | Throughput | p50 | p95 | Erros |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 127,2/min | 446 ms | 651 ms | 0 |
| 2 | 250,9/min | 458 ms | 615 ms | 0 |
| 4 | 486,9/min | 466 ms | 683 ms | 0 |

Foram observadas aproximadamente 24,5 queries por produto. Concorrência 1 é recomendada
para a primeira carga completa porque 2/4 foram validadas em no-op, mas não em criação
concorrente de definições compartilhadas.

O checkpoint persistente registra run ID, origem/destino, timestamps, página, contadores,
IDs concluídos e falhas sem segredos. O teste de interrupção e resume comprovou que IDs
concluídos não são reprocessados. Batch recomendado: 50 produtos por checkpoint, mantendo
uma transação independente por produto. Thresholds internos: WARN 300 MiB e STOP 400 MiB;
a referência oficial fornecida para o Free é 500 MB por projeto.

Fase E em implementação. O primeiro dry-run de dez produtos foi aprovado, mas nenhuma
linha de catálogo foi escrita no staging. Os gates de amostra estratificada, importação,
idempotência e catálogo completo continuam obrigatórios.

## Fonte auditada

O storefront atual usa a Store API pública (`wc/store/v1`) com cache/revalidação. O ETL
usa exclusivamente GET na REST API autenticada `wc/v3`, pois ela fornece status, SKU,
GTIN, variações, preços, estoque, taxonomias, mídia, descrições e metadata. As credenciais
permanecem server-only em `.env.local`.

Inventário observado em 2026-08-23: 3.080 produtos, 320 categorias, 153 marcas e 12
taxonomias globais. GTIN pode existir no campo nativo `global_unique_id` e no metadata
legado `hwp_product_gtin`; valores divergentes são conflito e não são resolvidos
automaticamente.

## Arquitetura

```text
catalog-import/
  config.mjs       argumentos, segredos e trava do staging
  extract.mjs      paginação GET-only, timeout, retry/backoff e métricas
  normalize.mjs    SKU, GTIN, money, marca, HTML e medidas racionais
  validate.mjs     produto, preço, atributos e grafo de categorias
  report.mjs       métricas e divergências estruturadas
  cli.mjs          orquestração e gates
```

O extrator pagina sem exigir o catálogo inteiro em memória, limita tentativas, trata 429/5xx
com backoff exponencial e jitter e não contém operação HTTP de escrita. Relatórios e futuros
checkpoints ficam em `supabase/.temp/catalog-import/`, fora do Git.

## Normalização

- SKU: trim e comparação uppercase; ausente vira conflito, nunca SKU inventado.
- GTIN: somente 8/12/13/14 dígitos com checksum válido; vazio vira NULL.
- Money: parsing decimal textual para bigint em centavos, sem float.
- Marca: espaços/Unicode normalizados, mantendo display; identidade futura usa mapping Woo.
- HTML: allowlist sem script, iframe ou handlers.
- Medidas compostas: um valor comercial com componentes racionais ordenados em mm/in.
- Categorias: validação de parent ausente, self-parent e ciclos profundos antes da escrita.

## Primeiro dry-run

Após corrigir suporte ao formato Woo com zeros decimais extras e tratar `pa_marca` como
entidade de marca, o lote de dez produtos resultou em 10 válidos, zero conflitos, zero
falhas, 10 SKUs e 10 GTINs válidos. Foram observadas 27 imagens e 15 atributos mapeados.
Sete requests foram feitas, sem retry, em aproximadamente 2,6 s. A amostra continha apenas
produtos simples; portanto ainda não libera escrita.

## Segurança e próximos gates

Woo permanece read-only e o Next não muda de data source. O importador de escrita deve usar
transação por produto, `external_mappings`, upsert sem DELETE ALL, checkpoint após commit e
reconciliação canônica. Antes do primeiro lote persistente ainda é necessário validar uma
amostra com produto variável, promoção, ausência de GTIN, múltiplas categorias/imagens,
medidas métricas/imperiais/compostas e indisponibilidade.

## Gate E.1 — discovery completo

A varredura read-only dos 3.080 produtos consumiu 38 requests, zero retries e cerca de
52,3 segundos. Foram encontrados casos reais de produto simples, GTIN presente/ausente,
promoção, múltiplas categorias/imagens, indisponibilidade, atributos globais, HTML e medidas
métricas/imperiais candidatas. As 320 categorias, 153 marcas e 12 taxonomias foram auditadas.

O source retornou zero produtos variáveis e zero variations. Como produto variável é gate
bloqueante na E.1, a primeira escrita não foi liberada naquele gate. Na E.2, a ausência foi
classificada como cobertura N/A da fonte e a capacidade foi validada por fixtures locais com
duas variations, SKU/GTIN/preço/estoque/atributos por variation, imagem opcional, GTIN NULL
e SKU ausente como conflito. A contagem foi preservada sem default variant artificial.

## Primeira importação real — E.2

Com o Gate A revisado aprovado, foram importados atomicamente os Woo IDs 9865, 11908,
19622, 5710, 5765, 6100, 6106, 9843, 9846 e 9850. Cada produto simples gerou exatamente
uma default variant. O lote resultou em 10 products, 10 variants, 6 brands, 13 categories,
29 media assets, 10 preços e 68 mappings. Nenhuma reserva ou movement foi criada.

A segunda execução criou zero products, variants, mappings, brands, categories, media,
prices ou movements adicionais. Um nome foi alterado temporariamente no staging e a nova
execução restaurou o valor Woo na mesma entidade, comprovando update sem duplicação.

A reconciliação final comparou SKU, GTIN, preço regular/promocional, estoque snapshot,
brand, IDs de categoria, IDs/contagem de mídia e PIM: zero diferenças críticas nos dez.
Duplicidades de mapping pela chave real, SKU e preço corrente: zero.

Tamanho do banco: 13.528.211 bytes antes; 13.798.547 após a primeira execução;
13.839.507 após a segunda. O crescimento lógico inicial da amostra foi aproximadamente
270 KiB; extrapolação linear simples sugere cerca de 97 MiB para banco base + 3.080 produtos,
sem imagens binárias. Essa projeção deve ser recalculada nos lotes 50/100 e varia conforme
mídia, atributos e bloat de updates.

## Escalonamento controlado — E.3

O schema passou a ter `prices.sale_valid_from` e `sale_valid_to` pela migration
`20260823110600_sale_periods.sql`. O ETL usa somente `date_on_sale_*_gmt`; datas locais sem
offset não são interpretadas. Promoção com preço e sem datas continua válida com ambos os
campos NULL. Na amostra de 100, as 22 promoções estavam sem datas na própria origem.

O Gate B terminou com 50 products e 50 default variants. A reconciliação 50/50 encontrou
zero diferenças críticas, duplicações ou movimentos de estoque. Após corrigir `published_at`
para usar `date_created_gmt`, a repetição idêntica teve 0 INSERT, 0 UPDATE, 0 DELETE e 1.019
no-ops. O banco terminou o gate com 14.601.363 bytes.

O Gate C adicionou 50 produtos e terminou com 100 products, 100 default variants, 244
relações de mídia e 70 assignments PIM. A reconciliação 100/100 e sua repetição encontraram
zero diferenças críticas. A segunda passagem teve 0 INSERT, 0 UPDATE, 0 DELETE e 2.037
no-ops. Mídia e PIM usam sincronização diferencial: relações obsoletas são removidas sem
apagar `media_assets`, `attributes` ou `attribute_values` compartilhados.

| Estágio | Produtos | Tamanho | Incremento |
| --- | ---: | ---: | ---: |
| base anterior à E.2 | 0 | 13.528.211 B | — |
| E.2 | 10 | 13.847.699 B | 319.488 B |
| Gate B | 50 | 14.601.363 B | 753.664 B |
| Gate C | 100 | 15.166.611 B | 565.248 B |

O incremento observado de 50→100 foi aproximadamente 11.305 bytes/produto. Uma projeção
estática conservadora baseada nesse trecho resulta em cerca de 46,6 MiB para 3.080 produtos,
67,3 MiB para 5.000 e 121,2 MiB para 10.000. Price history, inventory ledger, auditoria e
eventos são crescimento operacional separado e potencialmente ilimitado. O limite efetivo
do plano Supabase não foi obtido de fonte confiável nesta execução; portanto não foi usado
para afirmar capacidade.

Desempenho observado: Gate B, 37 GETs, 0 retries, extração 40,0 s, importação 24,0 s,
reconciliação 4,3 s, 124,9 produtos/min, p50 463 ms e p95 660 ms. Gate C, 37 GETs, 0
retries, extração 35,7 s, importação mista (50 no-op + 50 novos) 118,8 s, reconciliação
8,0 s, 50,5 produtos/min, p50 643 ms e p95 5.060 ms. A degradação de p95 deve ser
investigada antes da carga completa.

## Políticas comerciais — E.5

Valores monetários são convertidos a partir do texto decimal, sem ponto flutuante, com
arredondamento `HALF UP` para a menor unidade da moeda. A auditoria dos 197 preços com
precisão superior a centavos confirmou correspondência exata em 197/197 casos com os
inteiros publicados pela Woo Store API e consumidos pelo storefront, carrinho e checkout.

Para GTIN, `global_unique_id` é a fonte operacional preferencial: é o campo lido pela busca
Next e o destino da sincronização Olist por SKU exato no Persi Catalog Engine. Quando o
campo nativo e `hwp_product_gtin` são válidos e divergentes, o nativo vence e ambos os
candidatos permanecem na proveniência. Se um GTIN participa de grupo duplicado, nenhum
membro recebe propriedade arbitrária: o valor operacional é `NULL`. A restrição UNIQUE
parcial continua inalterada.

O full dry-run pós-política validou 3.080 produtos e 3.080 default variants, com zero SKU,
preço ou GTIN bloqueante. Isso libera tecnicamente a autorização de uma futura carga
completa, mas não a executa.

## Full catalog import — E.6

O run `catalog-full-20260824021524692-bd8142d7-3211-4a90-b784-1efe748e4036`
processou os 3.080 produtos com concorrência 1, transação por produto e checkpoint de 50.
Foram criados 2.980 produtos, os 100 existentes foram reutilizados e seus 200 mappings de
produto/variant mantiveram UUID. A reconciliação integral passou antes e depois da segunda
passagem. O WooCommerce permaneceu GET-only.

A segunda passagem produziu 56.590 no-ops e exatamente zero INSERT, UPDATE ou DELETE. O
banco permaneceu com 35.286.163 bytes, sem crescimento físico nessa passagem.
