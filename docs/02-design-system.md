# 02 — Design System

## Objetivo

Definir um padrão visual único para toda a Persi Materiais.

## Cores

### Paleta oficial

- Azul Persi: `#002B57` (`primary` / `heading`)
- Azul escuro: `#001F42` (`primary-hover`)
- Azul institucional: `#063B73` (`link` / `focus-ring`)
- Laranja Persi: `#FF6B00` (`secondary`)
- Laranja hover: `#E85F00` (`secondary-hover`)
- Texto principal: `#1F2937` (`foreground`)
- Texto secundÃ¡rio: `#687386` (`muted`)
- Fundo geral do site: `#F8FAFC` (`background`)
- SuperfÃ­cies e cards: `#FFFFFF` (`surface`)
- Fundo suave: `#F6F7F9` (`background-soft` / `surface-hover`)

Os tokens ficam centralizados em `app/globals.css` e sÃ£o expostos ao Tailwind.
NÃ£o repetir hexadecimais da marca em componentes.

### Hierarquia semÃ¢ntica

- conteÃºdo e descriÃ§Ãµes usam `foreground`;
- tÃ­tulos e identidade usam `heading` ou `primary`;
- links informativos usam `link`;
- CTAs e promoÃ§Ãµes usam `secondary`;
- informaÃ§Ãµes auxiliares usam `muted`;
- superfÃ­cies usam `background`, `surface` ou `background-soft`.

Cores de estado (`success`, `warning`, `danger`) e identidades de terceiros
(WhatsApp, redes sociais, meios de pagamento e fabricantes) nÃ£o devem ser
convertidas para a paleta Persi.

## Border Radius

Padrão:

- Botões: 8px
- Cards: 8px
- Inputs: 8px
- Modais: 8px

Elementos genuinamente circulares, como avatares, badges e botões de ícone
redondos, podem continuar usando `rounded-full`.

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

- `primary`: CTA de conversÃ£o com fundo laranja;
- `secondary`: aÃ§Ã£o secundÃ¡ria contornada em laranja;
- `outline`: aÃ§Ã£o institucional contornada em azul;
- `ghost`: aÃ§Ã£o terciÃ¡ria azul sem fundo;
- `destructive`: aÃ§Ã£o destrutiva com semÃ¢ntica de erro.

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
- 360px
- 375px
- 390px
- 430px
- 768px
- 1024px
- 1280px
- 1440px
- 1920px

## Consistência

Todo novo componente deve respeitar este Design System antes de ser incorporado ao projeto.
