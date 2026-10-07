import assert from "node:assert/strict";
import test from "node:test";
import {
  pickDefaultShippingRate,
  sortShippingRatesByPrice,
} from "../lib/commerce/shippingRateOrder.ts";

function rate(rateId, value, methodId = "flat_rate") {
  return {
    packageId: 0,
    rateId,
    name: rateId,
    price: { value, currencyMinorUnit: 2 },
    selected: false,
    methodId,
  };
}

test("ordena do frete mais barato para o mais caro sem alterar o original", () => {
  const rates = [rate("b", "3000"), rate("a", "1500"), rate("c", "0")];
  const sorted = sortShippingRatesByPrice(rates);
  assert.deepEqual(
    sorted.map((item) => item.rateId),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    rates.map((item) => item.rateId),
    ["b", "a", "c"],
  );
});

test("empate de preço mantém a ordem original", () => {
  const sorted = sortShippingRatesByPrice([
    rate("x", "1000"),
    rate("y", "1000"),
    rate("z", "900"),
  ]);
  assert.deepEqual(
    sorted.map((item) => item.rateId),
    ["z", "x", "y"],
  );
});

test("preço inválido vai para o fim", () => {
  const sorted = sortShippingRatesByPrice([rate("bad", "abc"), rate("ok", "500")]);
  assert.deepEqual(
    sorted.map((item) => item.rateId),
    ["ok", "bad"],
  );
});

test("padrão é a entrega mais barata e a retirada só se for a única opção", () => {
  const withPickup = [
    rate("retirada", "0", "local_pickup"),
    rate("sedex", "4000"),
    rate("pac", "2500"),
  ];
  assert.equal(pickDefaultShippingRate(withPickup)?.rateId, "pac");
  assert.equal(
    pickDefaultShippingRate([rate("retirada", "0", "local_pickup")])?.rateId,
    "retirada",
  );
  assert.equal(pickDefaultShippingRate([]), undefined);
});
