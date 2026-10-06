import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avisarSituacaoDoPedido,
  avisoDePendenteLigado,
  classificarPedido,
  montarAvisoDoPedido,
} from "../lib/painel/pedido.ts";
import { reconcilePaymentReference } from "../services/payments/reconcile.ts";
import { createPendingOrder, isOrderAlreadyPaidFor } from "../services/woocommerce/orders.ts";
import { serializarOrigemDoPedido } from "../lib/tracking/servidor.ts";

const origem = { ultimo_toque: { utm_source: "google", gclid: "GCL", em: "2026-10-04T00:00:00.000Z" }, fbp: "fb.1.1700000000000.1234567890" };
const pedido = (extra = {}) => ({
  id: 77, status: "pending", total: "100.00", currency: "BRL", paymentMethod: "inter_pix",
  billingEmail: "cli@exemplo.com", billingPhone: "11999998888",
  metaData: { _persi_origem: serializarOrigemDoPedido(origem) }, ...extra,
});

test("classificação do status do WooCommerce: pago, pendente, cancelado", () => {
  for (const s of ["processing", "completed"]) assert.equal(classificarPedido(s), "pago");
  for (const s of ["pending", "on-hold", "refunded", "qualquer"]) assert.equal(classificarPedido(s), "pendente");
  for (const s of ["failed", "cancelled"]) assert.equal(classificarPedido(s), "cancelado");
});

test("aviso PAGO: pago:true, status 'Pagamento aprovado', e-mail e origem", () => {
  const a = montarAvisoDoPedido(pedido(), "pago");
  assert.equal(a.pago, true);
  assert.equal(a.status, "Pagamento aprovado");
  assert.equal(a.email, "cli@exemplo.com");
  assert.equal(a.pedido, "77");
  assert.equal(a.origem.ultimo_toque.gclid, "GCL");
  assert.match(a.link, /\/minha-conta\/pedidos\/77$/);
});

test("aviso PENDENTE: pago:false e status 'Aguardando pagamento' — nunca 'Pagamento aprovado'", () => {
  const a = montarAvisoDoPedido(pedido(), "pendente");
  assert.equal(a.pago, false);
  assert.equal(a.status, "Aguardando pagamento");
});

test("aviso PENDENTE leva nome e valor (lead com valor); o PAGO não muda a mensagem ao cliente", () => {
  const p = pedido({ billingName: "Maria Souza", total: "259.90" });
  const pendente = montarAvisoDoPedido(p, "pendente");
  assert.equal(pendente.cliente, "Maria Souza");
  assert.equal(pendente.total_centavos, 25990);
  const pago = montarAvisoDoPedido(p, "pago");
  assert.equal("cliente" in pago, false);
  assert.equal("total_centavos" in pago, false);
});

test("aviso CANCELADO: pago:false e status 'Cancelado'", () => {
  const a = montarAvisoDoPedido(pedido({ status: "cancelled" }), "cancelado");
  assert.equal(a.pago, false);
  assert.equal(a.status, "Cancelado");
});

test("sem telefone não há aviso; sem origem o campo some; sem e-mail também", () => {
  assert.equal(montarAvisoDoPedido(pedido({ billingPhone: "" }), "pago"), null);
  const a = montarAvisoDoPedido(pedido({ metaData: {}, billingEmail: "" }), "pago");
  assert.equal("origem" in a, false);
  assert.equal("email" in a, false);
});

test("pendente/cancelado ficam DESLIGADOS por padrão (painel antigo não pode escrever ao cliente)", async () => {
  delete process.env.PAINEL_NOTIFICAR_PEDIDO_PENDENTE;
  assert.equal(avisoDePendenteLigado({}), false);
  assert.equal(avisoDePendenteLigado({ PAINEL_NOTIFICAR_PEDIDO_PENDENTE: "0" }), false);
  assert.equal(avisoDePendenteLigado({ PAINEL_NOTIFICAR_PEDIDO_PENDENTE: "1" }), true);
  const enviados = [];
  const enviar = async (a) => { enviados.push(a); return { enviado: true, conversa: null }; };
  const r = await avisarSituacaoDoPedido(pedido(), "pendente", enviar);
  assert.equal(r.enviado, false);
  assert.equal(enviados.length, 0);
  await avisarSituacaoDoPedido(pedido(), "cancelado", enviar);
  assert.equal(enviados.length, 0);
  // pago nunca depende da chave
  await avisarSituacaoDoPedido(pedido(), "pago", enviar);
  assert.equal(enviados.length, 1);
});

test("com a chave ligada, pendente e cancelado vão ao painel com pago:false", async () => {
  process.env.PAINEL_NOTIFICAR_PEDIDO_PENDENTE = "1";
  try {
    const enviados = [];
    const enviar = async (a) => { enviados.push(a); return { enviado: true, conversa: null }; };
    await avisarSituacaoDoPedido(pedido(), "pendente", enviar);
    await avisarSituacaoDoPedido(pedido(), "cancelado", enviar);
    assert.deepEqual(enviados.map((a) => [a.status, a.pago]), [["Aguardando pagamento", false], ["Cancelado", false]]);
  } finally {
    delete process.env.PAINEL_NOTIFICAR_PEDIDO_PENDENTE;
  }
});

test("falha ao avisar não lança", async () => {
  const r = await avisarSituacaoDoPedido(pedido(), "pago", async () => { throw new Error("boom"); });
  assert.equal(r.enviado, false);
});

// --- Conciliação: a trava "só quando MUDOU" ---------------------------------

function depsDeConciliacao(estado) {
  const avisos = { pago: [], cancelado: [] };
  return {
    avisos,
    deps: {
      findOrder: async () => estado.pedido,
      markPaid: async (o, ref) => {
        if (isOrderAlreadyPaidFor(o, ref.externalId)) return o;
        estado.pedido = { ...o, status: "processing", metaData: { ...o.metaData, _persi_payment_reference: ref.externalId } };
        return estado.pedido;
      },
      markFailed: async (o) => {
        if (o.status === "failed") return o;
        estado.pedido = { ...o, status: "failed" };
        return estado.pedido;
      },
      avisarPedido: async (o) => { avisos.pago.push(o.id); },
      avisarCancelado: async (o) => { avisos.cancelado.push(o.id); },
    },
  };
}
const solta = () => new Promise((ok) => setImmediate(ok));

test("REENVIO NÃO DUPLICA: o mesmo pagamento reconciliado 3 vezes avisa uma vez só", async () => {
  const estado = { pedido: pedido() };
  const { deps, avisos } = depsDeConciliacao(estado);
  for (let i = 0; i < 3; i++) await reconcilePaymentReference("inter", "TX1", "paid", deps);
  await solta();
  assert.deepEqual(avisos.pago, [77]);
});

test("pedido PENDENTE nunca dispara o aviso de pago", async () => {
  const estado = { pedido: pedido() };
  const { deps, avisos } = depsDeConciliacao(estado);
  await reconcilePaymentReference("inter", "TX1", "pending", deps);
  await solta();
  assert.deepEqual(avisos, { pago: [], cancelado: [] });
});

test("cancelamento/expiração avisa uma vez e não conta como pago", async () => {
  const estado = { pedido: pedido() };
  const { deps, avisos } = depsDeConciliacao(estado);
  await reconcilePaymentReference("inter", "TX1", "failed", deps);
  await reconcilePaymentReference("inter", "TX1", "failed", deps);
  await solta();
  assert.deepEqual(avisos, { pago: [], cancelado: [77] });
});

test("pedido que já chegou pago por OUTRA cobrança ainda é uma mudança (nova referência)", async () => {
  const estado = { pedido: pedido({ status: "processing", metaData: { _persi_payment_reference: "ANTIGA" } }) };
  assert.equal(isOrderAlreadyPaidFor(estado.pedido, "ANTIGA"), true);
  assert.equal(isOrderAlreadyPaidFor(estado.pedido, "NOVA"), false);
});

test("painel fora do ar não derruba a conciliação nem do cancelamento", async () => {
  const estado = { pedido: pedido() };
  const { deps } = depsDeConciliacao(estado);
  deps.avisarCancelado = async () => { throw new Error("painel fora do ar"); };
  const r = await reconcilePaymentReference("inter", "TX1", "failed", deps);
  await solta();
  assert.equal(r.order.status, "failed");
});

// --- Origem gravada no pedido ----------------------------------------------

test("createPendingOrder grava a origem como meta _persi_origem (e só quando existe)", async () => {
  const corpos = [];
  const post = async (_endpoint, corpo) => {
    corpos.push(corpo);
    return { id: 1, status: "pending", total: "10.00", currency: "BRL", meta_data: [] };
  };
  const base = {
    idempotencyKey: "k", ownerToken: "t", paymentMethod: "inter_pix",
    items: [{ productId: 1, variationId: 0, quantity: 1 }],
    billingAddress: { firstName: "A", lastName: "B", address1: "x", city: "c", state: "SP", postcode: "13000000", country: "BR" },
    shippingAddress: { firstName: "A", lastName: "B", address1: "x", city: "c", state: "SP", postcode: "13000000", country: "BR" },
  };
  await createPendingOrder({ ...base, origin: serializarOrigemDoPedido(origem) }, post);
  await createPendingOrder(base, post);
  const comOrigem = corpos[0].meta_data.find((m) => m.key === "_persi_origem");
  assert.ok(comOrigem);
  assert.equal(JSON.parse(comOrigem.value).ultimo_toque.utm_source, "google");
  assert.equal(corpos[1].meta_data.some((m) => m.key === "_persi_origem"), false, "sem cookies o pedido nasce como antes");
  // o resto do pedido é idêntico nos dois casos
  const semMeta = (c) => ({ ...c, meta_data: c.meta_data.filter((m) => m.key !== "_persi_origem") });
  assert.deepEqual(semMeta(corpos[0]), semMeta(corpos[1]));
});
