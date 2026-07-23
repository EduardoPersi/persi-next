# 02 — Design System

## Objetivo

Definir um padrão visual único para toda a Persi Materiais.

## Cores

- Azul superior: `#071f5c`
- Azul principal: `#0c2d72`
- Laranja: `#ff6a00`
- Branco: `#ffffff`

## Border Radius

Padrão:

- Botões: 12px
- Cards: 12px
- Inputs: 12px
- Modais: 12px

## Container

Toda página deve utilizar o componente `Container`.

Nunca criar containers diferentes por página.

## Tipografia

A interface utiliza apenas Inter como fonte principal. A configuração da
família é feita em `app/layout.tsx` com `next/font/google` e distribuída pelo
tema do Tailwind em `app/globals.css`.

### Escala tipográfica

| Elemento | Fonte | Peso |
| --- | --- | ---: |
| H1 | Inter | 700 |
| H2 | Inter | 700 |
| H3 | Inter | 600 |
| H4 | Inter | 600 |
| H5 | Inter | 600 |
| H6 | Inter | 600 |
| Texto | Inter | 400 |
| Botões | Inter | 500 |
| Menus | Inter | 600 |
| Preços | Inter | 700 |
| Parcelamento | Inter | 500 |
| Labels | Inter | 500 |
| Descrições | Inter | 400 |

### Tokens de peso

- `font-normal`: 400, para textos e descrições;
- `font-medium`: 500, para labels e parcelamentos;
- `font-semibold`: 600, para menus e títulos de H3 a H6;
- `font-bold`: 700, para H1, H2 e preços.

Os valores são definidos uma única vez no tema. Componentes não devem usar
pesos arbitrários nem declarar `font-family` localmente.

Sempre priorizar boa leitura em dispositivos móveis.

## Espaçamento

Usar a escala do Tailwind.

Evitar valores arbitrários.

## Botões

Variantes:

- Primary
- Secondary
- Outline
- Ghost
- Destructive

Todos devem suportar:

- loading
- disabled
- ícones
- largura total quando necessário

## Cards

Os cards de produto devem manter:

- imagem
- nome
- preço
- marca (quando aplicável)

Na Home, não exibir botão de adicionar ao carrinho.

## Ícones

Usar Lucide React.

## Responsividade

Projetar sempre em mobile first.

Validar em:

- 320px
- 375px
- 768px
- 1024px
- 1280px

## Consistência

Todo novo componente deve respeitar este Design System antes de ser incorporado ao projeto.
