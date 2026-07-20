# 10 — Padrões TypeScript

## Objetivo

Padronizar todo o código TypeScript do projeto.

## Regras

- `strict` habilitado.
- Evitar `any`.
- Preferir interfaces para modelos.
- Tipar todas as props.
- Tipar retorno de funções públicas.

## Organização

```text
types/
├── product.ts
├── category.ts
├── brand.ts
├── cart.ts
├── order.ts
└── customer.ts
```

## Convenções

- PascalCase para interfaces.
- camelCase para variáveis.
- Tipos reutilizáveis devem ficar em `types/`.

## API

Toda resposta externa deve ser validada antes do uso.

## Null e Undefined

Nunca assumir que campos existem.

## Erros

Modelar erros conhecidos em vez de ignorá-los.

## Refatoração

Substituir `any` gradualmente por tipos específicos.
