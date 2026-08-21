import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("etapas e resumos compartilham borda e sombra azul-claro", () => {
  const step = read("components/Checkout/CheckoutStepCard.tsx");
  const desktop = read("components/Checkout/CheckoutOrderSummary.tsx");
  const mobile = read("components/Checkout/CheckoutMobileOrderSummary.tsx");

  for (const source of [step, desktop, mobile]) {
    assert.match(source, /border-blue-200/);
    assert.match(source, /shadow-\[0_8px_24px_rgba\(59,130,246,0\.10\)\]/);
  }
});

test("perfil é mais estreito no desktop e não repete o campo visual de e-mail", () => {
  const form = read("components/Checkout/CheckoutForm.tsx");
  const contact = read("components/Checkout/CheckoutContactForm.tsx");
  const page = read("app/checkout/page.tsx");

  assert.match(form, /lg:grid-cols-\[minmax\(0,0\.9fr\)_minmax\(0,1\.1fr\)\]/);
  assert.match(contact, /type="hidden"/);
  assert.match(contact, /register\("contact\.email"\)/);
  assert.doesNotMatch(contact, /label="E-mail"/);
  assert.match(page, /initialGuestEmail=\{session\?\.customer\.email\}/);
});
