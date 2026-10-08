import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  pickShippingBadges,
  shippingBadgesForRates,
} from "../lib/shipping/shippingBadges.ts";

const read = (path) => readFileSync(path, "utf8");

const cand = (id, price, arrival) => ({ id, price, arrival });

test("mais barato e mais rápido em opções diferentes", () => {
  const badges = pickShippingBadges([
    cand("lenta", 1000, "2026-10-15"),
    cand("rapida", 2500, "2026-10-09"),
  ]);
  assert.deepEqual(badges, { lenta: "cheapest", rapida: "fastest" });
});

test("a mesma opção nos dois vira um selo só", () => {
  const badges = pickShippingBadges([
    cand("melhor", 1000, "2026-10-09"),
    cand("pior", 2500, "2026-10-15"),
  ]);
  assert.deepEqual(badges, { melhor: "cheapest-and-fastest" });
});

test("com menos de 2 opções pagas não há selo", () => {
  assert.deepEqual(pickShippingBadges([]), {});
  assert.deepEqual(pickShippingBadges([cand("so", 1000, "2026-10-09")]), {});
});

test("empate de preço: o mais barato é o de menor prazo; empate de prazo: o mais barato", () => {
  assert.deepEqual(
    pickShippingBadges([
      cand("a", 1000, "2026-10-15"),
      cand("b", 1000, "2026-10-09"),
    ]),
    { b: "cheapest-and-fastest" },
  );
  assert.deepEqual(
    pickShippingBadges([
      cand("a", 2000, "2026-10-09"),
      cand("b", 1500, "2026-10-09"),
      cand("c", 3000, "2026-10-20"),
    ]),
    { b: "cheapest-and-fastest" },
  );
});

test("opção sem prazo não concorre a 'mais rápido'; sem nenhum prazo, só 'mais barato'", () => {
  assert.deepEqual(
    pickShippingBadges([
      cand("sem-prazo", 800, null),
      cand("com-prazo", 2000, "2026-10-12"),
    ]),
    { "sem-prazo": "cheapest", "com-prazo": "fastest" },
  );
  assert.deepEqual(
    pickShippingBadges([cand("a", 800, null), cand("b", 900, null)]),
    { a: "cheapest" },
  );
});

test("empate total mantém a primeira opção (ordem original)", () => {
  assert.deepEqual(
    pickShippingBadges([cand("primeira", 1000, "2026-10-09"), cand("segunda", 1000, "2026-10-09")]),
    { primeira: "cheapest-and-fastest" },
  );
});

const money = (value) => ({
  value: String(value),
  currencyCode: "BRL",
  currencySymbol: "R$",
  currencyMinorUnit: 2,
});
const rate = (rateId, methodId, price, deliveryTime) => ({
  packageId: 0,
  rateId,
  name: "Frete Expresso",
  methodId,
  deliveryTime,
  price: money(price),
  selected: false,
});
// Quarta-feira, 7/10/2026, 10h em Brasília.
const NOW = new Date("2026-10-07T13:00:00Z");
const JUNDIAI = { postcode: "13201-000", city: "Jundiaí", uf: "SP" };

test("retirada e frete grátis ficam fora da comparação e não recebem selo", () => {
  const badges = shippingBadgesForRates(
    [
      rate("flat_rate:1", "flat_rate", 1500),
      rate("melhorenvio:3", "melhorenvio", 1000, "5 dias úteis"),
      rate("local_pickup:2", "local_pickup", 0),
      rate("free_shipping:3", "free_shipping", 0),
    ],
    JUNDIAI,
    NOW,
  );
  assert.deepEqual(badges, {
    "melhorenvio:3": "cheapest",
    "flat_rate:1": "fastest",
  });
});

test("uma paga + retirada + grátis: nenhum selo", () => {
  const badges = shippingBadgesForRates(
    [
      rate("flat_rate:1", "flat_rate", 1500),
      rate("local_pickup:2", "local_pickup", 0),
      rate("free_shipping:3", "free_shipping", 0),
    ],
    JUNDIAI,
    NOW,
  );
  assert.deepEqual(badges, {});
});

test("dois fretes com o mesmo nome continuam distintos pelo id", () => {
  const badges = shippingBadgesForRates(
    [
      rate("flat_rate:1", "flat_rate", 2200),
      rate("olist:9", "melhorenvio", 1800, "4 dias úteis"),
    ],
    JUNDIAI,
    NOW,
  );
  assert.equal(badges["olist:9"], "cheapest");
  assert.equal(badges["flat_rate:1"], "fastest");
});

test("os selos só aparecem ao lado do nome: nada de renomear nem mexer no pedido", () => {
  const card = read("components/Shipping/ShippingOptionCard.tsx");
  const checkout = read("components/Checkout/CheckoutShippingPlaceholder.tsx");
  const options = read("components/Shipping/ShippingOptions.tsx");
  assert.ok(card.includes("<ShippingBadgeLabel badge={badge} />"));
  assert.ok(card.includes("{rate.name}"));
  assert.ok(checkout.includes("<ShippingBadgeLabel"));
  assert.ok(checkout.includes("{rate.name}"));
  assert.ok(options.includes("badge={badgeFor(shippingPackage.packageId, rate.rateId)}"));
  // O selo não entra no que é enviado: nenhuma referência nos serviços e rotas.
  for (const path of [
    "lib/commerce/checkoutAddress.ts",
    "lib/commerce/shippingRateOrder.ts",
    "components/Cart/CartProvider.tsx",
  ]) {
    assert.ok(!read(path).includes("shippingBadges"));
  }
  const badge = read("components/UI/ShippingBadgeLabel.tsx");
  assert.ok(badge.includes("bg-emerald-50 text-emerald-700"));
  assert.ok(badge.includes("bg-secondary/10 text-secondary-hover"));
});
