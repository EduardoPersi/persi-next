# F.3 — Store API parity matrix

WooCommerce continua autoridade. Esta matriz cobre somente semânticas consumidas pelo Next; não replica `wp_postmeta` indiscriminadamente e não muda carrinho, frete calculado, checkout ou pedidos.

| Feature / Store API | Uso real no Next | Impacto | PostgreSQL / sync | Gate e teste |
|---|---|---|---|---|
| status + catalog visibility | listings, PDP, busca | comercial/SEO alto | `products.status`, `catalog_visibility`; fetch atual do Woo | blocker; 3.080/3.080 |
| purchasable | CTA de compra | comercial crítico | flag Woo exata `is_purchasable`, nunca inferida só por estoque/preço | blocker; 3.080/3.080 |
| stock/manage stock/backorders | cards, PDP, disponibilidade | comercial crítico | `woo_stock_status`, `manage_stock`, `allows_backorder`, inventory | blocker; 3.080/3.080; catálogo atual 0 backorders |
| rating médio/count | cards/PDP | merchandising | `average_rating`, `review_count`; sem reviews completas | blocker para equivalência visual; PASS |
| featured | merchandising | baixo no catálogo atual | `is_featured`; 0 atuais | sincronizado, PASS |
| popularity | ordenação | comercial médio | `popularity` replica `total_sales`, que é a fonte lida | blocker da ordenação; PASS |
| tags | recomendações | médio | `product_tags` + assignments | necessário; 3.791 relações, PASS |
| frete grátis | badges/cards/PDP | comercial alto | associação exata à classe Woo `frete-gratis` em `has_free_shipping` | badge PASS; cálculo continua Woo/checkout |
| imagem categoria/marca | Home, navegação e páginas | visual/SEO | somente URL e alt, sem copiar binário | 401 referências sincronizadas, PASS |
| category / brand | listagens e filtros | alto | relações estruturadas + external mapping | PASS |
| price / on-sale | filtros e sort | crítico | preços tipados em minor units | PASS |
| stock | filtro | alto | estado Woo + inventory | PASS |
| attributes | filtros/PIM | alto | atributos estruturados e display literal | PASS; preserva `3/4`, `1/2`, `20mm`, `32mm`, `16mm x 1/2\"` |
| search | busca, SKU, GTIN | alto | `catalog_search` | golden 14/14 |
| include/exclude | não usado como filtro público | nenhum no canary | não implementado | non-blocker |

Ordenações obrigatórias validadas: recentes, preço ascendente, preço descendente, popularidade, rating e disponibilidade (6/6). Todas usam `p.id` como desempate estável. Paginação de 100 itens: primeira, intermediária, última (80), página vazia, sem repetição.

`cano` ainda posiciona “Tucano” acima de alguns resultados por similaridade trigram. Como o golden continua aprovado e produtos semanticamente corretos aparecem no top 5, não foi feita uma alteração de ranking arriscada nesta fase. A melhoria geral por boundary de token fica como qualidade futura, com benchmark e golden obrigatórios.
