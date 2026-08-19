# 07 — Componentes

## Objetivo

Padronizar a criação de componentes reutilizáveis.

## Estrutura

components/
├── ui/
├── layout/
├── header/
├── footer/
├── home/
├── product/
├── category/
├── brand/
├── cart/
├── checkout/
└── forms/

## Componentes Base

- Container
- Button
- Input
- Select
- Checkbox
- Badge
- Card
- Modal
- Drawer
- Skeleton
- Breadcrumb

## Regras

- Responsabilidade única.
- Props tipadas.
- Sem lógica de API.
- Reutilização obrigatória.
- Mobile First.
- Acessível.
- Fácil manutenção.

## Header

Contém:

- Logo
- Busca
- Login
- Wishlist
- Carrinho
- Menu

## ProductCard

Mostrar:

- imagem
- nome
- preço
- marca

Na Home não exibir botão de compra.

## Boas práticas

- Evitar duplicação.
- Separar lógica da interface.
- Documentar componentes reutilizáveis.
- Não criar variantes desnecessárias.

## FlashDeals

### Objetivo e localização

`components/FlashDeals` concentra a seção reutilizável de Ofertas Relâmpago
da Home, produto, categoria e marca. O acesso ao WooCommerce fica isolado em
`services/woocommerce/flashDeals.ts`.

### Uso e estados

- Recebe um contexto `home`, `product`, `category` ou `brand`.
- Não renderiza quando o WooCommerce não possui ofertas elegíveis.
- Exibe 2 cards no celular, 4 no tablet e 6 em telas grandes.
- Produto simples e comprável usa o carrinho existente; variáveis direcionam
  para a página do produto.
- O timer no cliente recarrega a página ao encerrar a janela para obter o lote
  sincronizado seguinte.

### Dados, cache e rotação

- Somente produtos públicos da Store API, em promoção e disponíveis.
- Cache do catálogo: 300 segundos.
- Ranking: maior desconto, popularidade e recência.
- Rotação determinística por janelas UTC de 30 minutos, sem aleatoriedade por
  visitante.
- Na página de produto, exclui o item atual e tenta categoria, categoria pai,
  categorias irmãs e ofertas gerais nessa ordem.

### Acessibilidade, analytics e performance

- Título associado à seção, lista semântica, foco visível, labels e contador
  anunciado de forma descritiva.
- `view_promotion` é enviado na primeira visualização e `select_promotion` ao
  selecionar um item. `add_to_cart` permanece no fluxo central do carrinho.
- O catálogo e os cards são Server Components; apenas timer, observação de
  visibilidade e ações de compra hidratam no cliente.
