import assert from "node:assert/strict";
import test from "node:test";

import {
  BOLETO_DISCOUNT_RATE,
  PIX_DISCOUNT_RATE,
  calculatePaymentTotals,
} from "../lib/commerce/paymentDiscount.ts";

test("Pix desconta 10% exclusivamente dos produtos", () => {
  const totals = calculatePaymentTotals({
    method: "inter_pix",
    productsSubtotal: 2_500,
    existingDiscounts: 0,
    orderTotal: 2_650,
  });

  assert.equal(PIX_DISCOUNT_RATE, 0.1);
  assert.deepEqual(totals, {
    discountBase: 2_500,
    paymentDiscount: 250,
    finalTotal: 2_400,
  });
});

test("boleto desconta 5% exclusivamente dos produtos", () => {
  const totals = calculatePaymentTotals({
    method: "inter_boleto",
    productsSubtotal: 2_500,
    existingDiscounts: 0,
    orderTotal: 2_650,
  });

  assert.equal(BOLETO_DISCOUNT_RATE, 0.05);
  assert.deepEqual(totals, {
    discountBase: 2_500,
    paymentDiscount: 125,
    finalTotal: 2_525,
  });
});

test("cupom reduz a base antes do desconto e frete, taxas e impostos ficam integrais", () => {
  const totals = calculatePaymentTotals({
    method: "inter_pix",
    productsSubtotal: 2_500,
    existingDiscounts: 300,
    orderTotal: 2_390,
  });

  assert.deepEqual(totals, {
    discountBase: 2_200,
    paymentDiscount: 220,
    finalTotal: 2_170,
  });
});

test("cartão não recebe desconto e valores são arredondados em centavos", () => {
  assert.deepEqual(
    calculatePaymentTotals({
      method: "pagbank_card",
      productsSubtotal: 100.05,
      existingDiscounts: 0,
      orderTotal: 117.78,
    }),
    { discountBase: 100.05, paymentDiscount: 0, finalTotal: 117.78 },
  );

  assert.equal(
    calculatePaymentTotals({
      method: "inter_pix",
      productsSubtotal: 100.05,
      existingDiscounts: 0,
      orderTotal: 117.78,
    }).paymentDiscount,
    10.01,
  );
});
