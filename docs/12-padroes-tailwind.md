# 12 — Padrões Tailwind CSS

## Objetivo
Padronizar o uso do Tailwind CSS em todo o projeto.

## Filosofia
- Mobile First.
- Utilizar utilitários do Tailwind.
- Evitar CSS customizado quando possível.

## Estrutura

```text
app/globals.css
components/
styles/
```

## Espaçamento
Usar a escala padrão do Tailwind.

## Cores oficiais

- #071f5c
- #0c2d72
- #ff6a00

## Border Radius

Padrão de 12px para:

- botões
- inputs
- cards
- modais

## Classes

- Evitar duplicação.
- Utilizar `clsx` para condicionais.
- Não usar `!important`.

## Responsividade

Testar em:
- 320px
- 375px
- 768px
- 1024px
- 1280px

## Componentes

Nunca estilizar cada página individualmente quando um componente compartilhado puder resolver o problema.

## Checklist

- Consistência visual
- Boa leitura
- Bom contraste
- Sem CSS redundante
