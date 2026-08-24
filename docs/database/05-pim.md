# PIM — atributos e medidas técnicas

## Objetivo

Representar informação técnica e comercial de maneira tipada, pesquisável e
auditável, sem reproduzir EAV genérico de `wp_postmeta`. Catálogo possui produto
e variant; PIM possui definições e valores atribuídos a essas entidades.

## Product versus variant

- Product: conceito comercial, conteúdo compartilhado, marca e categorias.
- Variant: unidade vendável. Todo produto simples tem uma única variant; produto
  variável tem uma ou mais.
- SKU, GTIN, peso/dimensões logísticas, preço e estoque pertencem à variant.
- Atributos comuns (aplicação/material) podem pertencer ao product. Atributos que
  distinguem compra (bitola/cor/tensão) pertencem à variant.

## Definição de atributo

`attributes` define:

- `code`, name, description e data type:
  `text|boolean|integer|decimal|option|measurement|composite_measurement`;
- flags independentes: commercial, technical, variation, filterable,
  searchable, visible;
- cardinalidade `single|multiple`;
- unit family/constraints aplicáveis;
- status e sort order.

O tipo governa as colunas permitidas em `attribute_values`. Não existe blob
`value JSONB` indiscriminado. Opções controladas têm slug/label; números usam
`numeric`, nunca float.

## Unidades

`units` possui code, symbol, dimension/family, optional base unit e fator racional
ou `numeric` exato de conversão. V1 cadastra somente unidades necessárias: mm,
cm, m, in, g, kg, mL, L, W, kW, V, A, bar, psi, HP e CV. Conversões só são
oferecidas dentro da mesma dimensão e com regra testada.

Valor normalizado, unidade e display são separados. Exemplo: `12.7 mm` pode ser
normalizado para busca, enquanto display comercial continua `1/2"`.

## Medida composta

Um `attribute_value` composto preserva:

- `display_value`: texto aprovado, por exemplo `16mm x 1/2"`;
- `normalized_text`: forma para busca, por exemplo `16 mm x 1/2 in`;
- zero ou mais aliases de busca aprovados;
- componentes ordenados em `measurement_components`.

Cada componente guarda:

- position e semantic role (`diameter_a`, `thread_b`, `reduction_from` etc.);
- `numerator` e `denominator` inteiros coprimos para o valor exato;
- unit ID;
- display próprio (`16mm`, `1/2"`);
- optional normalized numeric para range/sort, derivado de forma exata.

Constraints: denominator > 0, numerator >= 0, posição única por valor e unidades
compatíveis com a regra do atributo. Frações críticas nunca são float.

## Exemplos

| Display | Component A | Component B | Search tokens/aliases |
| --- | --- | --- | --- |
| `16mm x 1/2"` | 16/1 mm | 1/2 in | `16mm`, `1/2`, `16 x 1/2`, forma completa |
| `25mm x 1/2"` | 25/1 mm | 1/2 in | `25mm`, `1/2`, `25 x 1/2`, forma completa |
| `32mm x 3/4"` | 32/1 mm | 3/4 in | `32mm`, `3/4`, `32 x 3/4`, forma completa |
| `32 x 25mm` | 32/1 mm | 25/1 mm | `32mm`, `25mm`, `32 x 25mm` |

`16mm x 1/2"` é um único valor comercial composto. Seus componentes existem
para filtro/conversão/busca, não como três opções comerciais concorrentes.

## Atribuição e variações

- `product_attribute_values`: N:N, suporta multi-value quando definição permite.
- `variant_attribute_values`: para atributo de variação, no máximo um valor por
  variant/attribute; a combinação de valores de variação deve ser única dentro
  do product.
- Um valor só pode ser atribuído à definição correspondente.
- Atributo marcado variation deve ser consistente entre variants do product.
- Alteração de display não muda a identidade do valor normalizado sem revisão.

## Filtros e busca

- Filtros exatos usam IDs de valores/opções, não strings de display.
- Range usa valor normalizado numa unidade-base compatível.
- Busca indexa nome, SKU/GTIN, marca, labels, display completo, componentes e
  aliases. `unaccent` e `pg_trgm` ajudam variações de grafia; FTS pondera campos.
- Sinônimos comerciais são curados em `search_synonyms`, não gravados como
  atributos falsos.
- Facets são derivadas apenas de atributos `filterable` publicados.

## Workflow de qualidade

1. fonte gera candidato com raw value, evidência e ruleset version;
2. parser normaliza sem apagar raw/display;
3. conflito/baixa confiança vai para revisão;
4. aprovação cria/reusa valor canônico;
5. associação é aplicada de forma idempotente;
6. mudança relevante emite outbox para search/cache.

Não promover automaticamente SKU duplicado, GTIN inválido ou medida ambígua.

## Plugin local Olist/PIM

Local: `wordpress-plugin/persi-catalog-engine/` 1.2.1, não rastreado no Git na
auditoria. Candidatos a extração de regras: `GtinValidator`,
`CompositeDimensionParser`, `ValueNormalizer`, dicionário/aliases, discovery
rules e fixtures futuras. Dependências WordPress (`$wpdb`, `WC_Product`, hooks,
admin, Action Scheduler/options) devem ser reescritas como adaptadores/jobs.

Antes de reutilizar: versionar em tarefa separada, revisar licença/segredos,
congelar casos reais como testes, separar funções puras e comparar o ruleset com
este modelo. O plugin não é dependência da Fase C.

## Restrições V1

- sem EAV genérico ou JSONB como valor padrão;
- sem conversão automática entre dimensões incompatíveis;
- sem criação automática de atributo público a partir de texto livre;
- sem apagar representação original;
- sem assumir que todo produto possui GTIN ou variação.
