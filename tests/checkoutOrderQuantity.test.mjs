import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getQuantityLimits,
  resolveTypedQuantity,
} from "../components/UI/quantityStepping.ts";

const read = (path) => readFileSync(path, "utf8");

test("carrinho, mini-carrinho e checkout usam o mesmo QuantityStepper", () => {
  const stepper = read("components/UI/QuantityStepper.tsx");
  const cart = read("components/Cart/CartPage.tsx");
  const miniCart = read("components/Header/MiniCart.tsx");
  const desktop = read("components/Checkout/CheckoutOrderSummary.tsx");
  const mobile = read("components/Checkout/CheckoutMobileOrderSummary.tsx");

  assert.equal(cart.split("<QuantityStepper item={item} />").length - 1, 2);
  assert.ok(miniCart.includes('<QuantityStepper item={item} />'));
  for (const summary of [desktop, mobile]) {
    assert.ok(summary.includes("<QuantityStepper"));
    assert.ok(summary.includes("itemCount={cart.items.length}"));
    assert.ok(summary.includes('emptyCartHref="/carrinho"'));
  }
  // O seletor em lista foi aposentado: nada de duas versões do controle.
  for (const source of [cart, miniCart, desktop, mobile]) {
    assert.ok(!source.includes("QuantitySelect"));
  }
  assert.ok(stepper.includes("memo(function QuantityStepper"));
  assert.match(stepper, /<QuantityControl/);
});

test("controle respeita limites e passos de quantidade do WooCommerce", () => {
  assert.deepEqual(
    getQuantityLimits({ minQuantity: 0, maxQuantity: undefined, quantityStep: 0 }),
    { minimum: 1, maximum: 999, step: 1 },
  );
  const stepper = read("components/UI/QuantityStepper.tsx");
  assert.ok(stepper.includes("getQuantityLimits(item)"));
  assert.ok(stepper.includes("stepQuantity(item.quantity, direction, limits)"));
  assert.ok(stepper.includes('resolveTypedQuantity(raw, limits, { zero: "remove" })'));
});

test("valor digitado respeita múltiplo de venda, mínimo e estoque", () => {
  const limits = { minimum: 10, maximum: 200, step: 10 };
  assert.deepEqual(resolveTypedQuantity("120", limits, { zero: "remove" }), {
    action: "update",
    quantity: 120,
  });
  assert.equal(resolveTypedQuantity("123", limits, { zero: "remove" }).quantity, 120);
  assert.equal(resolveTypedQuantity("500", limits, { zero: "remove" }).quantity, 200);
  assert.equal(resolveTypedQuantity("3", limits, { zero: "remove" }).quantity, 10);
  assert.deepEqual(resolveTypedQuantity("0", limits, { zero: "remove" }), { action: "remove" });
});

test("ajuste autoritativo de estoque retorna o carrinho e informa o cliente", () => {
  const control = read("components/UI/QuantityStepper.tsx");
  const provider = read("components/Cart/CartProvider.tsx");
  const route = read("app/api/cart/items/route.ts");

  assert.match(provider, /message: "Quantidade atualizada\.", cart: result/);
  assert.match(control, /result\.cart\?\.items\.find/);
  assert.ok(control.includes("conforme o estoque disponível."));
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
