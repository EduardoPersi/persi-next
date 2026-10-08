import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(path, "utf8");
}

test("a previsão só é calculada no navegador, depois da tela carregar", () => {
  const fonte = read("components/Shipping/ShippingArrival.tsx");
  assert.match(fonte, /^"use client";/);
  assert.match(fonte, /useEffect/);
  assert.match(fonte, /if \(!now\) return null/);
});

test("a calculadora (carrinho e produto) e o checkout mostram a previsão", () => {
  assert.match(read("components/Shipping/ShippingOptionCard.tsx"), /<ShippingArrival/);
  assert.match(read("components/Shipping/ShippingOptions.tsx"), /destination=\{shippingPackage\.destination\}/);
  const checkout = read("components/Checkout/CheckoutShippingPlaceholder.tsx");
  assert.match(checkout, /<ShippingArrival/);
  assert.match(checkout, /postcode: activeAddress\?\.postalCode/);
});

test("a previsão é só texto: nenhuma alteração de preço, frete escolhido ou total", () => {
  const fonte = read("components/Shipping/ShippingArrival.tsx") + read("lib/shipping/calendar/arrival.ts");
  assert.doesNotMatch(fonte, /selectShippingRate|updateCustomerAddress|totals|price/);
});
