# Identificadores de produto

## Frete Grátis

### Origem autoritativa

O WooCommerce é a única fonte. Um produto é identificado pela classe de
entrega já cadastrada no WooCommerce com slug `frete-gratis`. O Next.js apenas
interpreta e exibe essa informação; nunca deve cadastrar a flag manualmente,
criar atributo, tag ou metadado paralelo.

O plugin `Persi Headless` estende oficialmente os schemas de produto e item do
carrinho da Store API no namespace `extensions.persi.free_shipping`. A extensão
é calculada em tempo de resposta com `WC_Product::get_shipping_class()`.

### Destino e cálculo

Antes de haver CEP, a classe autoritativa permite informar a condição geral do
produto. Depois de um cálculo, o Next.js só mantém a mensagem quando a cotação
real do WooCommerce contém uma tarifa de entrega não-retirada com valor zero.
O cálculo e a seleção de tarifa nunca são reproduzidos no frontend.

No carrinho, os itens recebem a mesma flag pela Store API. O resumo só destaca
frete grátis quando todos os itens possuem a classe, o WooCommerce já calculou
o frete e o total oficial de entrega é zero.

### Cache, analytics e SEO

- A flag acompanha as respostas já cacheadas do catálogo, sem consulta extra.
- Cotações por CEP e carrinho permanecem privadas e `no-store`.
- A visualização do selo envia `free_shipping_badge_view` ao DataLayer.
- Eventos `view_item` e `add_to_cart` incluem `free_shipping` quando aplicável.
- O schema `Product` recebe `OfferShippingDetails` com tarifa zero e destino BR
  somente quando a classe oficial estiver presente.
