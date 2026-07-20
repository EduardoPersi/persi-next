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

Hierarquia:

- H1
- H2
- H3
- H4
- Texto
- Legendas

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
