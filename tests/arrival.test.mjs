import assert from "node:assert/strict";
import test from "node:test";
import {
  arrivalTextForRate,
  ownDeliveryDays,
  transitDaysOfRate,
} from "../lib/shipping/calendar/arrival.ts";

// Hora de São Paulo é UTC-3. 07/10/2026 é quarta-feira; 12/10 (segunda) é feriado.
const sp = (iso) => new Date(`${iso}-03:00`);

const proprio = { methodId: "flat_rate:3" };
const jundiai = { postcode: "13201-000", city: "Jundiaí", uf: "SP" };
const itupeva = { postcode: "13295-000", city: "Itupeva", uf: "SP" };

test("Jundiaí: pedido antes do corte chega hoje; depois do corte, amanhã", () => {
  assert.equal(arrivalTextForRate(proprio, jundiai, sp("2026-10-07T10:00:00")), "Chega hoje");
  assert.equal(arrivalTextForRate(proprio, jundiai, sp("2026-10-07T12:59:00")), "Chega hoje");
  assert.equal(arrivalTextForRate(proprio, jundiai, sp("2026-10-07T13:00:00")), "Chega amanhã, dia 8");
});

test("demais regiões: 1 dia antes do corte, 2 dias depois", () => {
  assert.equal(arrivalTextForRate(proprio, itupeva, sp("2026-10-07T10:00:00")), "Chega amanhã, dia 8");
  assert.equal(arrivalTextForRate(proprio, itupeva, sp("2026-10-07T14:00:00")), "Chega sexta, dia 9");
});

test("sábado: corte de 10h30; depois dele, domingo não opera e a segunda é feriado", () => {
  assert.equal(arrivalTextForRate(proprio, jundiai, sp("2026-10-10T09:00:00")), "Chega hoje");
  assert.equal(arrivalTextForRate(proprio, jundiai, sp("2026-10-10T10:29:00")), "Chega hoje");
  assert.equal(arrivalTextForRate(proprio, jundiai, sp("2026-10-10T10:30:00")), "Chega até a próxima terça, dia 13");
  assert.equal(arrivalTextForRate(proprio, jundiai, sp("2026-10-10T11:00:00")), "Chega até a próxima terça, dia 13");
});

test("a zona de Jundiaí vale pelo CEP ou pelo nome da cidade, sem acento", () => {
  assert.equal(ownDeliveryDays({ postcode: "13201000" }), 0);
  assert.equal(ownDeliveryDays({ postcode: "13219-999" }), 0);
  assert.equal(ownDeliveryDays({ postcode: "13220-000" }), 1);
  assert.equal(ownDeliveryDays({ city: "JUNDIAI" }), 0);
  assert.equal(ownDeliveryDays({ city: "Itupeva" }), 1);
  assert.equal(ownDeliveryDays({}), 1);
});

test("as zonas e os dias das demais regiões são configuráveis", () => {
  const zonas = [{ name: "Várzea", cities: ["Várzea Paulista"], operatingDays: 0 }];
  assert.equal(ownDeliveryDays({ city: "Várzea Paulista" }, zonas, 2), 0);
  assert.equal(ownDeliveryDays({ city: "Jundiaí" }, zonas, 2), 2);
});

test("transportadora: o prazo do Melhor Envio (meta) em dias úteis", () => {
  const rate = { methodId: "melhor_envio_33:1", metaData: [{ key: "melhorenvio_delivery_time", value: "2" }] };
  const sao = { postcode: "01310-100", city: "São Paulo", uf: "SP" };
  assert.equal(transitDaysOfRate(rate), 2);
  assert.equal(arrivalTextForRate(rate, sao, sp("2026-10-07T10:00:00")), "Chega sexta, dia 9");
  // Depois do corte e com o feriado de segunda no meio.
  assert.equal(arrivalTextForRate(rate, sao, sp("2026-10-07T14:00:00")), "Chega até a próxima terça, dia 13");
});

test("transportadora: o prazo vem do texto quando não há meta (Olist Envios)", () => {
  const rate = { methodId: "olist_envios", deliveryTime: "2 dias úteis" };
  assert.equal(transitDaysOfRate(rate), 2);
  assert.equal(arrivalTextForRate(rate, { uf: "SP" }, sp("2026-10-07T10:00:00")), "Chega sexta, dia 9");
  assert.equal(transitDaysOfRate({ methodId: "x", deliveryTime: "3" }), 3);
});

test("transportadora sem prazo, ou com prazo absurdo, não tem previsão", () => {
  assert.equal(arrivalTextForRate({ methodId: "melhor_envio_1" }, {}, sp("2026-10-07T10:00:00")), null);
  assert.equal(transitDaysOfRate({ deliveryTime: "Sob consulta" }), null);
  assert.equal(transitDaysOfRate({ deliveryTime: "9999 dias" }), null);
});

test("retirada na loja não tem previsão de chegada", () => {
  assert.equal(arrivalTextForRate({ methodId: "local_pickup:4" }, jundiai, sp("2026-10-07T10:00:00")), null);
  assert.equal(arrivalTextForRate({ methodId: "pickup_location" }, jundiai, sp("2026-10-07T10:00:00")), null);
});

test("frete grátis da loja segue a regra da entrega própria", () => {
  assert.equal(arrivalTextForRate({ methodId: "free_shipping:1" }, jundiai, sp("2026-10-07T10:00:00")), "Chega hoje");
});

test("feriado municipal do destino atrasa a transportadora (Itu, Corpus Christi 04/06/2026)", () => {
  const rate = { methodId: "melhor_envio_1", metaData: [{ key: "melhorenvio_delivery_time", value: "3" }] };
  const agora = sp("2026-06-02T10:00:00");
  assert.equal(arrivalTextForRate(rate, { uf: "SP", city: "Cabreúva" }, agora), "Chega sexta, dia 5");
  assert.equal(arrivalTextForRate(rate, { uf: "SP", city: "Itu" }, agora), "Chega até a próxima segunda, dia 8");
});
