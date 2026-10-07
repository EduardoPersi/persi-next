import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

test("barra fixa mobile observa o botão real e só aparece na etapa de pagamento", () => {
  const source = read("components/Checkout/CheckoutMobileSubmitBar.tsx");
  assert.match(source, /new IntersectionObserver/);
  assert.match(source, /observer\.disconnect\(\)/);
  assert.match(source, /if \(!active \|\| realButtonInView\) return null/);
  // Visível só no mobile e sem estilo inline.
  assert.match(source, /lg:hidden/);
  assert.doesNotMatch(source, /style=\{/);
  // O clique dispara o botão real, para reaproveitar validação e envio.
  assert.match(source, /submitButtonRef\.current\?\.click\(\)/);
  assert.match(source, /type="button"/);
});

test("CheckoutForm liga a barra ao botão Comprar e ao total com desconto de pagamento", () => {
  const source = read("components/Checkout/CheckoutForm.tsx");
  assert.match(source, /ref=\{submitButtonRef\}/);
  assert.match(source, /<CheckoutMobileSubmitBar/);
  assert.match(source, /active=\{currentStep === "payment"\}/);
  assert.match(source, /getCartPaymentTotals\(paymentMethod, cart\)\.finalTotal/);
});
