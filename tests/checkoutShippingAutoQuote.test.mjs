import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cartRatesMatchPostcode,
  shouldAutoQuotePostcode,
} from "../lib/commerce/checkoutShippingAutoQuote.ts";

const base = {
  postcode: "13201-000",
  addressComplete: false,
  cartPostcode: undefined,
  cartRateCount: 0,
  lastQuotedPostcode: "",
};

test("CEP válido já preenchido, sem cotação no carrinho: cota sozinho", () => {
  assert.equal(shouldAutoQuotePostcode(base), true);
  assert.equal(shouldAutoQuotePostcode({ ...base, postcode: "13201000" }), true);
});

test("CEP incompleto ou vazio não cota", () => {
  assert.equal(shouldAutoQuotePostcode({ ...base, postcode: "" }), false);
  assert.equal(shouldAutoQuotePostcode({ ...base, postcode: "13201-0" }), false);
});

test("cota uma única vez por CEP", () => {
  assert.equal(
    shouldAutoQuotePostcode({ ...base, lastQuotedPostcode: "13201000" }),
    false,
  );
  // Outro CEP depois volta a cotar.
  assert.equal(
    shouldAutoQuotePostcode({ ...base, postcode: "13300-000", lastQuotedPostcode: "13201000" }),
    true,
  );
});

test("não cota de novo se o carrinho já tem opções para esse CEP", () => {
  assert.equal(
    shouldAutoQuotePostcode({ ...base, cartPostcode: "13201000", cartRateCount: 2 }),
    false,
  );
  // CEP do carrinho diferente do formulário: precisa cotar.
  assert.equal(
    shouldAutoQuotePostcode({ ...base, cartPostcode: "13300000", cartRateCount: 2 }),
    true,
  );
  // Mesmo CEP, mas sem nenhuma opção: tenta.
  assert.equal(
    shouldAutoQuotePostcode({ ...base, cartPostcode: "13201000", cartRateCount: 0 }),
    true,
  );
});

test("endereço completo deixa a cotação para a atualização de endereço (sem duplicar)", () => {
  assert.equal(shouldAutoQuotePostcode({ ...base, addressComplete: true }), false);
});

test("opções do carrinho só valem se forem do CEP do formulário", () => {
  assert.equal(cartRatesMatchPostcode("13201-000", "13201000", 1), true);
  assert.equal(cartRatesMatchPostcode("13201-000", "13300000", 1), false);
  assert.equal(cartRatesMatchPostcode("13201-000", "13201000", 0), false);
  assert.equal(cartRatesMatchPostcode("13201", "13201000", 1), false);
});

test("a etapa de entrega cota pelo CEP, mostra o aviso e bloqueia enquanto consulta", () => {
  const source = readFileSync("components/Checkout/CheckoutShippingPlaceholder.tsx", "utf8");
  assert.ok(source.includes("calculateShippingPostcode("));
  assert.ok(source.includes("shouldAutoQuotePostcode({"));
  assert.ok(source.includes("Consultando opções de entrega…"));
  // O avançar já fica travado por isCheckoutUpdating (CheckoutForm).
  const form = readFileSync("components/Checkout/CheckoutForm.tsx", "utf8");
  assert.ok(form.includes("disabled={!addressReady || isCheckoutUpdating}"));
  assert.ok(form.includes("disabled={isCheckoutUpdating || isSubmittingPayment}"));
});
