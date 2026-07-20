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
