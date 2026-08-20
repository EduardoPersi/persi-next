# Identificadores de produto

## Frete Grátis

### Origem autoritativa

O WooCommerce é a única fonte. Um produto é identificado pela classe de
entrega já cadastrada no WooCommerce com slug `frete-gratis`. O Next.js apenas
interpreta e exibe essa informação; nunca deve cadastrar a flag manualmente,
criar atributo, tag ou metadado paralelo.

O Next.js localiza a classe pela REST API autenticada em
`/wp-json/wc/v3/products/shipping_classes?slug=frete-gratis` e consulta somente
os produtos associados em `/wp-json/wc/v3/products?shipping_class={id}`. O
plugin `Persi Headless` não altera a Store API para esta funcionalidade.

### Destino e cálculo

Antes de haver CEP, a classe autoritativa permite informar a condição geral do
produto. Depois de um cálculo, o Next.js só mantém a mensagem quando a cotação
real do WooCommerce contém uma tarifa de entrega não-retirada com valor zero.
O cálculo e a seleção de tarifa nunca são reproduzidos no frontend.

No carrinho, os itens são cruzados com a mesma lista oficial. O resumo só destaca
frete grátis quando todos os itens possuem a classe, o WooCommerce já calculou
o frete e o total oficial de entrega é zero.

### Cache, analytics e SEO

- A lista oficial é compartilhada e revalidada a cada 5 minutos. A consulta não
  é repetida por card ou produto.
- Se a REST API autenticada falhar, o catálogo continua funcionando sem o selo.
- Cotações por CEP e carrinho permanecem privadas e `no-store`.
- A visualização do selo envia `free_shipping_badge_view` ao DataLayer.
- Eventos `view_item` e `add_to_cart` incluem `free_shipping` quando aplicável.
- O schema `Product` recebe `OfferShippingDetails` com tarifa zero e destino BR
  somente quando a classe oficial estiver presente.
