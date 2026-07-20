# 11 — Padrões React

## Objetivo
Definir como componentes React devem ser criados neste projeto.

## Regras Gerais
- Server Components por padrão.
- `"use client"` apenas quando necessário.
- Componentes pequenos.
- Uma responsabilidade por componente.
- Props sempre tipadas.

## Organização

```text
components/
├── ui/
├── layout/
├── product/
├── category/
├── cart/
└── forms/
```

## Convenções
- PascalCase para componentes.
- Hooks iniciam com `use`.
- Evitar lógica de negócio em componentes.
- Extraia lógica para `services` ou `hooks`.

## Estado
- Manter estado o mais próximo possível.
- Evitar duplicação de estado.
- Preferir Server Components para carregamento de dados.

## Performance
- Evitar renderizações desnecessárias.
- Lazy loading para componentes pesados.
- Não utilizar Context API sem necessidade.

## Checklist
- Tipado
- Responsivo
- Reutilizável
- Acessível
