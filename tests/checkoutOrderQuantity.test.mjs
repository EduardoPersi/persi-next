import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("carrinho e checkout reutilizam o seletor compacto de quantidade", () => {
  const control = read("components/UI/QuantitySelect.tsx");
  const cart = read("components/Cart/CartPage.tsx");
  const desktop = read("components/Checkout/CheckoutOrderSummary.tsx");
  const mobile = read("components/Checkout/CheckoutMobileOrderSummary.tsx");

  assert.match(cart, /<QuantitySelect item=\{item\} idSuffix="cart-mobile" \/>/);
  assert.match(cart, /<QuantitySelect item=\{item\} idSuffix="cart-desktop" \/>/);
  assert.match(desktop, /<QuantitySelect item=\{item\} idSuffix="checkout-desktop" \/>/);
  assert.match(mobile, /<QuantitySelect item=\{item\} idSuffix="checkout-mobile" \/>/);
  assert.match(control, /memo\(function QuantitySelect/);
  assert.match(control, /aria-label=\{label\}/);
  assert.match(control, /title=\{label\}/);
  assert.match(control, /h-9 w-\[52px\]/);
  assert.match(control, /role="alert"/);
});

test("controle respeita limites e passos de quantidade do WooCommerce", () => {
  const control = read("components/UI/QuantitySelect.tsx");

  assert.match(control, /Math\.max\(1, item\.minQuantity\)/);
  assert.match(control, /item\.maxQuantity \?\? 999/);
  assert.match(control, /Math\.max\(1, item\.quantityStep\)/);
  assert.match(control, /nextQuantity < minimum/);
  assert.match(control, /nextQuantity > maximum/);
});

test("seletor oferece até 10 e expande para preservar quantidade existente", () => {
  const control = read("components/UI/QuantitySelect.tsx");

  assert.match(control, /DEFAULT_VISIBLE_MAXIMUM = 10/);
  assert.match(control, /SURROUNDING_OPTION_COUNT = 7/);
  assert.match(control, /value > DEFAULT_VISIBLE_MAXIMUM/);
  assert.match(control, /currentIndex - radius/);
  assert.match(control, /if \(!options\.includes\(value\)\) options\.push\(value\)/);
});

test("ajuste autoritativo de estoque retorna o carrinho e informa o cliente", () => {
  const control = read("components/UI/QuantitySelect.tsx");
  const provider = read("components/Cart/CartProvider.tsx");
  const route = read("app/api/cart/items/route.ts");

  assert.match(provider, /message: "Quantidade atualizada\.", cart: result/);
  assert.match(control, /result\.cart\?\.items\.find/);
  assert.match(control, /A quantidade foi ajustada conforme o estoque disponível\./);
  assert.match(route, /availableMaximum < quantity/);
  assert.match(route, /updateCartItem\(key, availableMaximum, cartToken\)/);
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

test("cupom expansível fica no resumo e não é duplicado na etapa de endereço", () => {
  const coupon = read("components/Checkout/CheckoutCoupon.tsx");
  const desktop = read("components/Checkout/CheckoutOrderSummary.tsx");
  const mobile = read("components/Checkout/CheckoutMobileOrderSummary.tsx");
  const form = read("components/Checkout/CheckoutForm.tsx");

  assert.match(coupon, /<details/);
  assert.match(coupon, /Tenho um cupom de desconto/);
  assert.match(desktop, /<CheckoutCoupon idSuffix="desktop-summary" embedded \/>/);
  assert.match(mobile, /<CheckoutCoupon idSuffix="mobile-summary" embedded \/>/);
  assert.doesNotMatch(form, /<CheckoutCoupon/);
});
