# 13 — Componentes de Layout

## Objetivo

Padronizar todos os componentes estruturais do projeto.

## Componentes principais

- Container
- Header
- TopBar
- SearchBar
- Navigation
- MobileMenu
- MiniCart
- HeroBanner
- Footer
- Breadcrumb
- Section

## Container

Responsável por limitar a largura máxima do conteúdo.

Regras:

- utilizar em todas as páginas;
- manter espaçamento horizontal consistente;
- evitar múltiplos containers diferentes;
- alterações devem impactar todo o projeto de forma controlada.

## Header

Deve conter:

- logo;
- busca;
- login;
- wishlist;
- carrinho;
- menu principal.

No mobile:

- menu lateral;
- busca otimizada;
- mini carrinho.

## Footer

Dividido em:

- institucional;
- categorias;
- atendimento;
- redes sociais;
- formas de pagamento.

## HeroBanner

- imagem otimizada;
- prioridade apenas quando for o LCP;
- textos administráveis;
- CTA destacado.

## Breadcrumb

Obrigatório em:

- categorias;
- produtos;
- marcas.

## Regras gerais

- componentes reutilizáveis;
- acessíveis;
- responsivos;
- sem lógica de API;
- separados da camada de serviços.
