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

- Azul Persi: `#002B57`
- Azul escuro: `#001F42`
- Azul institucional: `#063B73`
- Laranja Persi: `#FF6B00`
- Laranja hover: `#E85F00`
- Texto principal: `#1F2937`
- Texto secundÃ¡rio: `#687386`
- Fundo suave: `#F6F7F9`

Usar os tokens Tailwind definidos em `app/globals.css`; hexadecimais literais
sÃ³ sÃ£o aceitos para estados ou identidades de terceiros documentadas.

## Border Radius

Padrão de 8px para:

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
