import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("checkout usa um controle de quantidade acessível nos dois resumos", () => {
  const control = read("components/Checkout/CheckoutQuantityControl.tsx");
  const desktop = read("components/Checkout/CheckoutOrderSummary.tsx");
  const mobile = read("components/Checkout/CheckoutMobileOrderSummary.tsx");

  assert.match(desktop, /<CheckoutQuantityControl item=\{item\} \/>/);
  assert.match(mobile, /<CheckoutQuantityControl item=\{item\} \/>/);
  assert.match(control, /Diminuir quantidade de \$\{item\.name\}/);
  assert.match(control, /Aumentar quantidade de \$\{item\.name\}/);
  assert.match(control, /h-11 w-11/);
  assert.match(control, /role="alert"/);
});

test("controle respeita limites do Woo e não remove no mínimo", () => {
  const control = read("components/Checkout/CheckoutQuantityControl.tsx");

  assert.match(control, /Math\.max\(1, item\.minQuantity\)/);
  assert.match(control, /item\.maxQuantity \?\? 999/);
  assert.match(control, /Math\.max\(1, item\.quantityStep\)/);
  assert.match(control, /item\.quantity <= minimum/);
  assert.match(control, /item\.quantity >= maximum/);
});

test("alteração usa PATCH existente e substitui o carrinho pela resposta autoritativa", () => {
  const provider = read("components/Cart/CartProvider.tsx");
  const route = read("app/api/cart/items/route.ts");

  assert.match(provider, /fetch\("\/api\/cart\/items"/);
  assert.match(provider, /method: "PATCH"/);
  assert.match(provider, /setCart\(result\)/);
  assert.match(provider, /setIsCheckoutUpdating\(true\)/);
  assert.match(provider, /AbortSignal\.timeout\(15_000\)/);
  assert.match(route, /updateCartItem\(key, quantity, cartToken\)/);
});

test("frete só mostra grátis quando há método selecionado com total zero", () => {
  for (const path of [
    "components/Checkout/CheckoutOrderSummary.tsx",
    "components/Checkout/CheckoutMobileOrderSummary.tsx",
  ]) {
    const summary = read(path);
    assert.match(summary, /hasSelectedShippingRate/);
    assert.match(summary, /isZeroMoney\(cart\.totals\.shipping\)/);
    assert.match(summary, /"Grátis"/);
    assert.match(summary, /"A calcular"/);
  }
});
