import assert from "node:assert/strict";
import test from "node:test";
import { moneyToNumber } from "../lib/formatting/money.ts";

test("moneyToNumber converte string em unidade menor para número em reais", () => {
  assert.equal(
    moneyToNumber({ value: "19990", currencyCode: "BRL", currencySymbol: "R$", currencyMinorUnit: 2 }),
    199.9,
  );
});

test("moneyToNumber retorna 0 para valores inválidos", () => {
  assert.equal(
    moneyToNumber({ value: "abc", currencyCode: "BRL", currencySymbol: "R$", currencyMinorUnit: 2 }),
    0,
  );
});
