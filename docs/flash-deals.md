# Ofertas Relâmpago

## Objetivo

O sistema `FlashDeals` fornece uma vitrine única e reutilizável para Home,
produto, categoria e marca. Toda administração comercial permanece no
WooCommerce.

## Tags oficiais do projeto

### `ofertas-relampago`

Controla exclusivamente os produtos autorizados para a vitrine principal de
Ofertas Relâmpago da Home.

Um produto marcado ainda precisa estar publicado, visível na Store API, em
estoque e com promoção ativa no WooCommerce. A própria Store API considera o
estado corrente das datas agendadas da promoção ao responder `on_sale=true`.

Se a tag não possuir nenhum produto elegível, a Home utiliza automaticamente o
algoritmo geral: maior desconto, depois popularidade e depois recência. A seção
não é removida enquanto houver alguma oferta geral elegível.

### `super-oferta`

Tag reservada para campanhas futuras, incluindo:

- Black Friday;
- liquidação;
- Natal;
- aniversário Persi;
- mega promoções.

Ainda não é utilizada pela aplicação.

## Regras por contexto

### Home

- Usa primeiro a tag `ofertas-relampago`.
- Aplica fallback para as ofertas gerais quando a tag não retorna elegíveis.
- Em mobile, usa carrossel em loop com autoplay de três segundos, swipe nativo,
  pausa durante interação e retomada automática após cinco segundos.
- Em tablet e desktop, preserva o grid existente de quatro e seis cards.

### Produto

Não utiliza tags. Mantém a seleção por categoria atual, categoria pai,
categorias irmãs e ofertas gerais, excluindo o produto atual.

### Categoria e marca

Não exibem a seção de Ofertas Relâmpago. Mantêm apenas seus filtros e catálogo
próprios.

## Cache e rotação

- Catálogos cacheados por 300 segundos com o cache do Next.js.
- Lotes determinados por janelas UTC de 30 minutos.
- Seleção determinística, sem `random()`, igual para todos os visitantes.
- O contador roda no navegador e atualiza a página ao trocar de janela.

## Analytics e performance

O componente continua usando o DataLayer existente para `view_promotion` e
`select_promotion`. A adição ao carrinho mantém o `add_to_cart` centralizado no
provedor atual. Nenhuma nova biblioteca ou implementação de analytics foi
adicionada.

Os dados e cards permanecem em Server Components. Apenas timer, detecção de
visibilidade, ação de compra e carrossel mobile usam JavaScript no cliente.
