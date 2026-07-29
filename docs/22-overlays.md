# 22 — Overlays e componentes flutuantes

## Objetivo

Padronizar dropdowns, autocompletes, popovers, modais, lightboxes e drawers.
Todo novo componente flutuante deve registrar sua abertura no
`OverlayManagerProvider` e usar `useClickOutside` quando clique externo fizer
sentido.

## `useOverlayManager`

Use o hook com um identificador estável, o estado aberto e a função de
fechamento:

```tsx
useOverlayManager({
  id: "product-share",
  isOpen,
  onClose,
  returnFocusRef: triggerRef,
});
```

Ao ativar um overlay, o gerenciador fecha o overlay anteriormente registrado.
O listener de Escape existe somente enquanto `isOpen` for verdadeiro. Quando
fornecido, `returnFocusRef` recebe foco após Escape.

## `useClickOutside`

Passe todos os elementos considerados internos, inclusive conteúdo renderizado
por Portal:

```tsx
useClickOutside({
  isOpen,
  refs: [triggerRef, contentRef],
  onOutside: onClose,
  ignoreRefs: [toastRef],
  ignoreSelectors: [".tooltip"],
});
```

O hook usa `pointerdown` em captura, funcionando com mouse, toque e caneta. O
listener só é instalado quando o componente está aberto e é removido no
cleanup.

## Boas práticas

- Use IDs únicos e estáveis.
- Não registre tooltips puramente informativos.
- Inclua trigger e conteúdo em `refs`.
- Use `ignoreSelectors` apenas para exceções documentadas.
- Preserve animações e controles de foco próprios do componente.
- Fundos escurecidos devem continuar fechando ao serem acionados.
- Não duplique listeners permanentes de `mousedown` ou `touchstart`.

## Componentes compatíveis

- dropdown Minha Conta;
- busca preditiva;
- menu Compartilhar;
- Quick View;
- lightbox;
- modal nativo de formas de pagamento;
- filtros mobile;
- Drawer genérico.

O minicarrinho mantém sua infraestrutura própria enquanto carrinho estiver fora
do escopo de migração. Ao alterar esse fluxo futuramente, ele deverá aderir ao
mesmo gerenciador em tarefa específica.
