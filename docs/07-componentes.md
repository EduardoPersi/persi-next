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
da Home e da página de produto. O acesso ao WooCommerce fica isolado em
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

## QuantitySelect

### Objetivo e localização

`components/UI/QuantitySelect.tsx` é o seletor compacto de quantidade usado
exclusivamente pelos itens do Carrinho e pelos resumos desktop e mobile do
Checkout. Vitrines, página de produto, mini carrinho, upsell e cross sell
continuam usando seus controles próprios.

### Comportamento e estados

- Exibe quantidades válidas de acordo com mínimo, máximo e passo informados
  pelo WooCommerce.
- Mostra inicialmente até 10 opções. Acima disso, mostra uma janela de sete
  valores próximos da quantidade atual, sem reduzir quantidades existentes.
- Usa o fluxo central do carrinho para atualizar preços, descontos, frete e
  total sem recarregar a página.
- Mantém o campo focável durante a atualização do próprio item e mostra um
  indicador de progresso; mutações concorrentes ficam bloqueadas.
- Erros recuperáveis são anunciados junto ao campo.

### Responsividade, acessibilidade e performance

- Mede 52 px no mobile e 64 px a partir do breakpoint `sm`, sempre sem quebra.
- Possui nome acessível, `title`, foco visível e operação nativa por teclado.
- É memorizado com `React.memo`; as opções também são memorizadas e nenhuma
  dependência adicional é necessária.

### Reutilização futura

Favoritos, Minhas Listas, Workspace e uma futura compra recorrente devem usar
este mesmo componente quando passarem a possuir itens reais de carrinho e uma
ação de quantidade. Atualmente essas áreas não armazenam quantidade; por isso,
o componente não deve ser inserido nelas apenas como controle visual sem efeito.
