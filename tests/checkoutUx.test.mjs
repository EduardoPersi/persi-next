import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

test("CheckoutHeader não inclui menu de categorias, busca, mini-cart ou conta (cabeçalho enxuto)", () => {
  const source = read("components/Header/CheckoutHeader.tsx");
  assert.doesNotMatch(source, /MegaMenu|ProductSearch|MiniCart|AccountDropdown|AccountDrawer/);
  assert.match(source, /href="\/"/);
});

test("checkout usa o CheckoutHeader em vez do Header completo em todas as suas páginas", () => {
  const checkoutPage = read("app/checkout/page.tsx");
  const confirmationPage = read("app/checkout/confirmacao/page.tsx");
  for (const source of [checkoutPage, confirmationPage]) {
    assert.match(source, /CheckoutHeader/);
    assert.doesNotMatch(source, /<Header\s*\/>/);
  }
});

test("FooterVisibility esconde o rodapé completo só nas rotas de checkout", () => {
  const source = read("components/Footer/FooterVisibility.tsx");
  assert.match(source, /"\/checkout"/);
  assert.match(source, /usePathname/);
});

test("beforeunload usa preventDefault + returnValue, exigidos pelos navegadores para mostrar o diálogo nativo", () => {
  const source = read("hooks/useBeforeUnloadWarning.ts");
  assert.match(source, /addEventListener\("beforeunload"/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /event\.returnValue/);
});

test("useTabAttentionTitle escuta visibilitychange e sempre restaura o título original, nunca um texto fixo", () => {
  const source = read("hooks/useTabAttentionTitle.ts");
  assert.match(source, /addEventListener\("visibilitychange"/);
  assert.match(source, /originalTitleRef\.current = document\.title/);
  assert.match(source, /document\.title = originalTitleRef\.current/);
});

test("CheckoutForm liga os dois hooks de UX e os desliga assim que o pedido é criado", () => {
  const source = read("components/Checkout/CheckoutForm.tsx");
  assert.match(source, /useBeforeUnloadWarning\(hasUnsavedProgress && !hasCreatedOrder\)/);
  assert.match(source, /useTabAttentionTitle\(!hasCreatedOrder\)/);
  // Todos os quatro ramos de sucesso do submit precisam marcar o pedido
  // como criado antes de seguir (Pix, boleto, cartão/carteira, já iniciado).
  // `hasCreatedOrder` é elevado a CheckoutPageClient (onOrderCreated) para
  // que a página de checkout não trate o carrinho esvaziado pós-pagamento
  // como "carrinho vazio" e derrube a tela do Pix/boleto.
  assert.match(source, /onOrderCreated: setHasCreatedOrder/);
  const setHasCreatedOrderCount = source.split("setHasCreatedOrder()").length - 1;
  assert.equal(setHasCreatedOrderCount, 4);
});
