import assert from "node:assert/strict";
import test from "node:test";
import { matchConditions } from "../lib/rules/matchConditions.ts";

const cart = {
  subtotal: 350,
  itemCount: 4,
  weight: 12.5,
  productIds: [10, "22"],
  categories: ["Elétrica", "Hidráulica"],
  tags: ["promo"],
  coupons: ["BEMVINDO"],
  paymentMethod: "inter_pix",
  shippingMethod: "flat_rate",
  postcode: "13201-000",
  city: "Jundiaí",
  state: "SP",
  isLoggedIn: false,
};

test("sem grupos ou só grupos vazios não restringe nada", () => {
  assert.equal(matchConditions(undefined, cart), true);
  assert.equal(matchConditions([], cart), true);
  assert.equal(matchConditions([[]], cart), true);
});

test("linhas do mesmo grupo são E, grupos são OU", () => {
  const andPass = [
    [
      { type: "subtotal", op: ">=", value: 300 },
      { type: "state", op: "==", value: "sp" },
    ],
  ];
  const andFail = [
    [
      { type: "subtotal", op: ">=", value: 300 },
      { type: "state", op: "==", value: "RJ" },
    ],
  ];
  assert.equal(matchConditions(andPass, cart), true);
  assert.equal(matchConditions(andFail, cart), false);
  assert.equal(
    matchConditions([...andFail, [{ type: "item_count", op: "==", value: 4 }]], cart),
    true,
  );
});

test("condições numéricas aceitam todos os operadores", () => {
  const check = (op, value) =>
    matchConditions([[{ type: "subtotal", op, value }]], cart);
  assert.equal(check("==", 350), true);
  assert.equal(check("!=", 350), false);
  assert.equal(check(">=", 351), false);
  assert.equal(check("<=", 350), true);
  assert.equal(check(">=", "abc"), false);
});

test("listas de produto, categoria, tag e cupom ignoram acento e caixa", () => {
  assert.equal(
    matchConditions([[{ type: "category", op: "==", value: "eletrica" }]], cart),
    true,
  );
  assert.equal(
    matchConditions([[{ type: "category", op: "!=", value: "Tintas" }]], cart),
    true,
  );
  assert.equal(
    matchConditions([[{ type: "product", op: "==", value: 22 }]], cart),
    true,
  );
  assert.equal(
    matchConditions([[{ type: "coupon", op: "==", value: "bemvindo" }]], cart),
    true,
  );
  assert.equal(
    matchConditions([[{ type: "tag", op: ">=", value: "promo" }]], cart),
    false,
  );
});

test("CEP casa por prefixo e por faixa", () => {
  const rule = (value, op = "==") => [[{ type: "postcode", op, value }]];
  assert.equal(matchConditions(rule("132"), cart), true);
  assert.equal(matchConditions(rule("133"), cart), false);
  assert.equal(matchConditions(rule("13200000-13219999"), cart), true);
  assert.equal(matchConditions(rule("13300000-13319999"), cart), false);
  assert.equal(matchConditions(rule("132", "!="), cart), false);
  assert.equal(
    matchConditions(rule("13200000-13219999"), { ...cart, postcode: "132" }),
    false,
  );
});

test("cidade, UF, pagamento, entrega e login", () => {
  assert.equal(
    matchConditions([[{ type: "city", op: "==", value: "jundiai" }]], cart),
    true,
  );
  assert.equal(
    matchConditions([[{ type: "payment_method", op: "==", value: "inter_pix" }]], cart),
    true,
  );
  assert.equal(
    matchConditions([[{ type: "shipping_method", op: "!=", value: "local_pickup" }]], cart),
    true,
  );
  assert.equal(
    matchConditions([[{ type: "logged_in", op: "==", value: false }]], cart),
    true,
  );
});

test("data, dia da semana e horário usam o fuso de São Paulo", () => {
  // 2026-10-06 (terça) 01:30 UTC = 2026-10-05 (segunda) 22:30 em São Paulo.
  const now = new Date("2026-10-06T01:30:00Z");
  const check = (type, op, value) =>
    matchConditions([[{ type, op, value }]], { ...cart, now });
  assert.equal(check("date", "==", "2026-10-05"), true);
  assert.equal(check("weekday", "==", 1), true);
  assert.equal(check("hour", ">=", 22), true);
  assert.equal(check("hour", "<=", 21), false);
  assert.equal(check("date", ">=", "2026-10-06"), false);
});

test("regra malformada nunca casa", () => {
  assert.equal(matchConditions([[{ type: "inexistente", op: "==", value: 1 }]], cart), false);
  assert.equal(matchConditions([[{ type: "subtotal", op: "~", value: 1 }]], cart), false);
  assert.equal(matchConditions([[{ type: "subtotal", op: ">=", value: 1 }]], {}), false);
});
