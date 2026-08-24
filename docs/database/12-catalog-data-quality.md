# Qualidade de dados do catálogo — Gate E.1

## Bloqueios

## Full dry-run — 3.080 produtos

O preflight read-only examinou os 3.080 produtos em 38 GETs, sem retry. Todos são simples,
possuem SKU válido e os SKUs normalizados são únicos. Foram observados 6.324 vínculos de
mídia, 3.080 preços regulares, 186 sale prices e 736 produtos fora de estoque.

Bloqueios para carga completa:

- 197 regular prices possuem casas decimais não nulas além de centavos. O ETL os rejeita;
  arredondar, truncar ou escolher outro campo exige decisão comercial.
- 29 ocorrências adicionais reutilizam GTIN já visto e violariam a unicidade do schema.
- 14 produtos possuem conflito entre `global_unique_id` e `hwp_product_gtin`.

GTIN ausente não bloqueia: 152 produtos permanecem NULL. Existem 2.885 GTINs válidos e
distintos antes das repetições.

Foram contadas 1.410 opções PIM mapeadas e 237 valores ambíguos. `Marca=Hidrossol` e
`Cor=Preto` tiveram equivalência determinística comprovada. Permanece um unmapped: Woo ID
9043, `Tamanho="39""40""41""42""43"`, preservado sem inferência.

### Ausência de produtos variáveis

A varredura read-only dos 3.080 produtos retornados pela REST API `wc/v3/products`
encontrou zero produtos com `type=variable`. A cobertura real foi registrada como
`NOT APPLICABLE — source count = 0`. A E.2 autorizou validar a capacidade por fixtures
locais; elas passaram para parent com duas variations e preservação de SKU, GTIN/NULL,
preço, estoque, atributos, imagem e contagem. Nenhuma fixture foi apresentada como dado Woo.

### Medidas compostas ambíguas

O discovery encontrou textos com separador `x`, incluindo candidatos como `3/4" x 1` e
`20 mm x 1`, mas nenhum dos vinte candidatos coletados continha simultaneamente unidade
`mm` explícita e polegada explícita. Inferir automaticamente a unidade ausente nesses casos
pode produzir semântica falsa. Eles ficam classificados como `ambiguous`, preservando
display e normalized text sem componentes, até regra comercial ou contexto de família
confiável. Nenhuma unidade foi inferida.

## Categorias

As 320 categorias foram auditadas. Não foram encontrados self-parent, parent ausente,
ciclo, ciclo profundo, slug duplicado no mesmo parent ou nome normalizado duplicado no
mesmo parent.

## Marcas

As 153 marcas foram agrupadas por nome normalizado/slug sem encontrar colisão exata. Não
foi feita fusão por similaridade. A taxonomia global `pa_marca` apareceu em 2.973 produtos.

## Taxonomias e atributos

As 12 taxonomias globais foram classificadas: `pa_marca` como brand e as outras 11 como
typed PIM. Atributos locais não cadastrados como taxonomia global permanecem unresolved:

| Nome/chave | Ocorrências | Produtos de exemplo | Valores de exemplo |
| --- | ---: | --- | --- |
| `marca` | 2 | 23941, 23945 | Hidrossol |
| `tamanho` | 1 | 9043 | valor concatenado de tamanhos |
| `cor` | 1 | 23941 | Preto |

Esses quatro usos não serão transformados automaticamente em novos tipos PIM.

## Cobertura da amostra de 100 — E.3

### Critical

Nenhum conflito crítico de SKU, GTIN, preço, mapping ou contagem foi encontrado. Os 100
produtos possuem SKU válido e único. Existem 94 GTINs válidos e únicos; seis produtos não
possuem GTIN e permanecem NULL.

### High

O p95 de importação subiu de 660 ms no Gate B para 5.060 ms no Gate C. Embora não tenha
causado falha ou retry, a causa deve ser medida antes de importar o catálogo completo.

### Medium

Foram contabilizados 70 assignments PIM mapeados, três opções locais não mapeadas e cinco
valores com padrão composto ambíguo. Os ambíguos permanecem preservados sem inferência.

### Low

Nenhum produto da amostra ficou sem imagem. Existem 244 referências, média de 2,44 por
produto. Os binários continuam fora do PostgreSQL.

### Info

A amostra cobre 88 marcas e 172 categorias. Noventa e seis opções `pa_marca` foram
classificadas como marca, não como PIM. As 22 promoções possuem sale price sem datas na
origem, situação preservada pelo ETL.

## Resolução de preços e GTIN — E.5

Os 197 preços fracionários usam `HALF UP`: 99 arredondam para cima e 98 para baixo. O
resultado coincide em 197/197 casos com a Store API. `HALF EVEN` diverge em um caso e
truncamento diverge em 99 casos, somando 99 centavos de diferença.

Os 14 conflitos entre fontes foram resolvidos com precedência de `global_unique_id`. Os 27
grupos duplicados, envolvendo 56 produtos e 29 ocorrências adicionais, não têm evidência
suficiente para atribuir automaticamente o código a um item. Todos recebem GTIN operacional
`NULL`; os valores brutos continuam auditáveis. Assim, 27/27 grupos estão neutralizados,
mas 0/27 tiveram propriedade comercial inferida. Somados aos 152 produtos sem código, o
full dry-run produz 208 GTINs `NULL` e zero bloqueio.

## Estado persistido após E.6

Os 3.080 SKUs foram persistidos sem ausência ou duplicidade. Há 208 GTINs operacionais
`NULL` e nenhum GTIN não nulo duplicado. Os 27 grupos continuam no backlog de saneamento,
sem proprietário inferido. Foram persistidos 1.410 assignments PIM; o único valor unmapped
e os 237 ambíguos permanecem preservados/classificados sem inferência. Nenhum componente
de medida foi criado artificialmente.
