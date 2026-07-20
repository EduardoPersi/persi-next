# 01 — Arquitetura Next.js

## Objetivo

Este documento define a arquitetura oficial do projeto Persi Materiais em Next.js.

## Princípios

- App Router obrigatório.
- Server Components por padrão.
- Client Components apenas quando necessário.
- Componentes pequenos e reutilizáveis.
- Separação entre UI, serviços e acesso à API.

## Estrutura

```text
app/
components/
hooks/
lib/
services/
types/
utils/
```

## App Router

Cada rota deve conter apenas a responsabilidade da página.

Exemplo:

```text
app/
├── page.tsx
├── categoria/[slug]/page.tsx
├── produto/[slug]/page.tsx
├── marca/[slug]/page.tsx
├── busca/page.tsx
├── carrinho/page.tsx
├── checkout/page.tsx
```

## Organização

- `components/ui`: componentes reutilizáveis.
- `components/layout`: Header, Footer, Container.
- `components/product`: componentes da página de produto.
- `services`: comunicação com WooCommerce.
- `lib`: helpers, constantes e integrações.
- `types`: interfaces globais.

## Fluxo de dados

WordPress/WooCommerce → API → Services → Server Components → UI

## Boas práticas

- Não acessar API diretamente dentro de componentes.
- Não duplicar lógica.
- Centralizar validações.
- Usar TypeScript estrito.
- Preparar cache por tipo de dado.

## Erros

Usar `error.tsx`, `loading.tsx` e `not-found.tsx` conforme padrão do App Router.

## Evolução

Novas funcionalidades devem seguir esta arquitetura e nunca criar acoplamentos desnecessários.
