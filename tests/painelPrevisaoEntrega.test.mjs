import { test } from "node:test";
import assert from "node:assert/strict";

// FASE 7 DO PAINEL, lado do site: a previsão de entrega (AAAA-MM-DD) que o
// checkout mostrou ao cliente, congelada no pedido e enviada em
// `envio.previsao_entrega`. Atrás de PAINEL_ENVIAR_PREVISAO_ENTREGA=1.
import {
  META_PREVISAO_CALCULADA_EM,
  META_PREVISAO_ENTREGA,
  calcularPrevisaoCongelada,
  dataCivilValida,
  lerPrevisaoDoPedido,
  metasDaPrevisao,
  previsaoEntregaLigada,
} from "../lib/painel/previsaoEntrega.ts";
import { montarAvisoDoPedido } from "../lib/painel/pedido.ts";
import { arrivalTextForRate } from "../lib/shipping/calendar/arrival.ts";
import { createPendingOrder } from "../services/woocommerce/orders.ts";

const LIGADA = { PAINEL_ENVIAR_PREVISAO_ENTREGA: "1" };
// Quinta-feira, 08/10/2026: 11h42 (antes do corte das 13h) e 13h05 (depois), em São Paulo.
const ANTES_DO_CORTE = new Date("2026-10-08T14:42:10Z");
const DEPOIS_DO_CORTE = new Date("2026-10-08T16:05:00Z");

const entregaDaLoja = { methodId: "flat_rate" };
const jundiai = { postcode: "13201-000", city: "Jundiaí", uf: "SP" };
const itupeva = { postcode: "13295-000", city: "Itupeva", uf: "SP" };

const calcular = (extra = {}) =>
  calcularPrevisaoCongelada({
    rate: entregaDaLoja, destino: jundiai, entregaPropria: true, agora: ANTES_DO_CORTE, env: LIGADA, ...extra,
  });

test("a chave PAINEL_ENVIAR_PREVISAO_ENTREGA vem desligada por padrão", () => {
  assert.equal(previsaoEntregaLigada({}), false);
  assert.equal(previsaoEntregaLigada({ PAINEL_ENVIAR_PREVISAO_ENTREGA: "0" }), false);
  assert.equal(previsaoEntregaLigada({ PAINEL_ENVIAR_PREVISAO_ENTREGA: "1" }), true);
  assert.equal(previsaoEntregaLigada({ PAINEL_ENVIAR_PREVISAO_ENTREGA: "true" }), true);
});

test("chave desligada: nada é calculado e o pedido não ganha meta", () => {
  assert.equal(calcular({ env: {} }), null);
  assert.deepEqual(metasDaPrevisao(calcular({ env: {} })), []);
});

test("Jundiaí antes do corte: hoje; depois do corte: o próximo dia de operação", () => {
  assert.equal(calcular().data, "2026-10-08");
  assert.equal(calcular({ agora: DEPOIS_DO_CORTE }).data, "2026-10-09");
});

test("outras regiões da entrega da loja levam 1 dia a mais", () => {
  assert.equal(calcular({ destino: itupeva }).data, "2026-10-09");
  assert.equal(calcular({ destino: itupeva, agora: DEPOIS_DO_CORTE }).data, "2026-10-10");
});

test("é a MESMA data que o texto do checkout mostra ao cliente", () => {
  // O checkout diz "Chega hoje" / "Chega amanhã, dia 9"; a previsão tem de bater.
  assert.match(arrivalTextForRate(entregaDaLoja, jundiai, ANTES_DO_CORTE), /hoje/i);
  assert.equal(calcular().data, "2026-10-08");
  assert.match(arrivalTextForRate(entregaDaLoja, itupeva, ANTES_DO_CORTE), /amanhã, dia 9/i);
  assert.equal(calcular({ destino: itupeva }).data, "2026-10-09");
});

test("retirada e transportadora não têm previsão para o painel", () => {
  assert.equal(calcular({ entregaPropria: false }), null);
  assert.equal(calcular({ rate: { methodId: "local_pickup" }, entregaPropria: false }), null);
  assert.equal(calcular({ rate: { methodId: "" } }), null);
});

test("a previsão leva o instante em que foi calculada", () => {
  assert.equal(calcular().calculadaEm, "2026-10-08T14:42:10.000Z");
});

test("os metas gravados no pedido têm nome documentado", () => {
  assert.equal(META_PREVISAO_ENTREGA, "_persi_previsao_entrega");
  assert.equal(META_PREVISAO_CALCULADA_EM, "_persi_previsao_calculada_em");
  assert.deepEqual(metasDaPrevisao(calcular()), [
    { key: "_persi_previsao_entrega", value: "2026-10-08" },
    { key: "_persi_previsao_calculada_em", value: "2026-10-08T14:42:10.000Z" },
  ]);
});

test("data civil: só vale AAAA-MM-DD que existe no calendário", () => {
  assert.equal(dataCivilValida("2026-10-08"), true);
  assert.equal(dataCivilValida("2026-02-30"), false);
  assert.equal(dataCivilValida("08/10/2026"), false);
  assert.equal(dataCivilValida("2026-10-8"), false);
  assert.equal(dataCivilValida(""), false);
  assert.equal(dataCivilValida(undefined), false);
});

test("lerPrevisaoDoPedido: meta torta é ignorada, não vira previsão errada", () => {
  assert.deepEqual(
    lerPrevisaoDoPedido({ _persi_previsao_entrega: "2026-10-09", _persi_previsao_calculada_em: "2026-10-08T14:42:10.000Z" }),
    { data: "2026-10-09", calculadaEm: "2026-10-08T14:42:10.000Z" },
  );
  assert.deepEqual(lerPrevisaoDoPedido({ _persi_previsao_entrega: "2026-10-09", _persi_previsao_calculada_em: "ontem" }), {
    data: "2026-10-09", calculadaEm: "",
  });
  assert.equal(lerPrevisaoDoPedido({ _persi_previsao_entrega: "2026-02-30" }), null);
  assert.equal(lerPrevisaoDoPedido({ _persi_previsao_entrega: "amanhã" }), null);
  assert.equal(lerPrevisaoDoPedido({}), null);
});

// ---------------------------------------------------------------------------
// O aviso ao painel
// ---------------------------------------------------------------------------

const pedido = (extra = {}, metodoId = "flat_rate") => ({
  id: 4512, billingPhone: "11988887777", billingEmail: "maria@exemplo.com.br", billingName: "Maria Souza",
  total: "209.40", paymentMethod: "inter_pix",
  metaData: { _persi_previsao_entrega: "2026-10-08", _persi_previsao_calculada_em: "2026-10-08T14:42:10.000Z" },
  entrega: {
    endereco: { cep: "13201-000", rua: "Rua do Retiro", cidade: "Jundiaí", uf: "SP" },
    itens: [{ nome: "Cimento", quantidade: 4 }],
    frete: { metodoId, metodo: "Entrega Persi (Jundiaí)", centavos: 1100 },
  },
  ...extra,
});

for (const situacao of ["pendente", "pago", "cancelado"]) {
  test(`aviso ${situacao}: envio leva previsao_entrega e entrega_propria quando a chave está ligada`, () => {
    const aviso = montarAvisoDoPedido(pedido(), situacao, LIGADA);
    assert.equal(aviso.envio.entrega_propria, true);
    assert.equal(aviso.envio.previsao_entrega, "2026-10-08");
    assert.equal(aviso.envio.previsao_calculada_em, "2026-10-08T14:42:10.000Z");
  });
}

test("aviso com a chave desligada: o envio é idêntico ao de antes (sem previsão)", () => {
  const aviso = montarAvisoDoPedido(pedido(), "pago", {});
  assert.deepEqual(aviso.envio, {
    metodo: "Entrega Persi (Jundiaí)", entrega_propria: true, retirada: false, frete_centavos: 1100,
  });
});

test("retirada e transportadora nunca levam previsão, mesmo com meta no pedido", () => {
  for (const metodo of ["local_pickup", "melhorenvio_sedex"]) {
    const aviso = montarAvisoDoPedido(pedido({}, metodo), "pago", LIGADA);
    assert.equal(aviso.envio.entrega_propria, false);
    assert.equal("previsao_entrega" in aviso.envio, false, metodo);
    assert.equal("previsao_calculada_em" in aviso.envio, false, metodo);
  }
});

test("pedido sem meta (antigo, ou criado com a chave desligada) não leva previsao_entrega", () => {
  const aviso = montarAvisoDoPedido(pedido({ metaData: {} }), "pago", LIGADA);
  assert.equal(aviso.envio.entrega_propria, true);
  assert.equal("previsao_entrega" in aviso.envio, false);
});

test("meta com data impossível não vai ao painel", () => {
  const aviso = montarAvisoDoPedido(pedido({ metaData: { _persi_previsao_entrega: "2026-02-30" } }), "pago", LIGADA);
  assert.equal("previsao_entrega" in aviso.envio, false);
});

test("o pedido pago tarde (boleto) leva a data CONGELADA, não uma recalculada", () => {
  // O meta diz 08/10; o aviso sai muito depois e continua dizendo 08/10.
  const aviso = montarAvisoDoPedido(pedido(), "pago", LIGADA);
  assert.equal(aviso.envio.previsao_entrega, "2026-10-08");
});

// ---------------------------------------------------------------------------
// A criação do pedido grava os metas
// ---------------------------------------------------------------------------

const endereco = {
  firstName: "Maria", lastName: "Silva", address1: "Rua do Rosário, 1", city: "Jundiaí", state: "SP",
  postcode: "13201000", country: "BR", email: "maria@example.com",
};
const entradaDoPedido = (extra = {}) => ({
  idempotencyKey: "key-1",
  items: [{ productId: 1, variationId: 0, quantity: 1 }],
  billingAddress: endereco,
  shippingAddress: endereco,
  paymentMethod: "inter_pix",
  ownerToken: "cart-token-1",
  shippingLine: { name: "Entrega Persi (Jundiaí)", amount: 11, methodId: "flat_rate" },
  ...extra,
});
const postFalso = (chamadas) => async (endpoint, body) => {
  chamadas.push({ endpoint, body });
  return { id: 501, status: "pending", total: "20.00", currency: "BRL", meta_data: body.meta_data };
};

test("createPendingOrder grava a previsão em metas do pedido e o pedido devolvido a traz", async () => {
  const chamadas = [];
  const order = await createPendingOrder(entradaDoPedido({ deliveryForecast: calcular() }), postFalso(chamadas));
  const metas = Object.fromEntries(chamadas[0].body.meta_data.map((m) => [m.key, m.value]));
  assert.equal(metas._persi_previsao_entrega, "2026-10-08");
  assert.equal(metas._persi_previsao_calculada_em, "2026-10-08T14:42:10.000Z");
  assert.equal(order.metaData._persi_previsao_entrega, "2026-10-08");
});

test("createPendingOrder sem previsão cria o pedido exatamente como antes (nenhum meta novo)", async () => {
  const chamadas = [];
  await createPendingOrder(entradaDoPedido(), postFalso(chamadas));
  const chaves = chamadas[0].body.meta_data.map((m) => m.key);
  assert.deepEqual(chaves, ["_persi_idempotency_key", "_persi_payment_provider", "_persi_checkout_owner_token"]);
});

test("ponta a ponta: pedido criado -> pendente -> pago -> cancelado repetem a mesma data", async () => {
  const chamadas = [];
  const criado = await createPendingOrder(entradaDoPedido({ deliveryForecast: calcular() }), postFalso(chamadas));
  const comTudo = { ...pedido(), metaData: criado.metaData };
  for (const situacao of ["pendente", "pago", "cancelado"]) {
    assert.equal(montarAvisoDoPedido(comTudo, situacao, LIGADA).envio.previsao_entrega, "2026-10-08", situacao);
  }
});
