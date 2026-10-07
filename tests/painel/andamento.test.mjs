import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// FASE B: o andamento do pedido pelo WhatsApp (cancelado, entregue, reembolso,
// enviado) e o "Pagamento aprovado" completo. Contrato no persi-atendimento,
// docs/contrato-api-sites.md §3.3.
import {
  andamentoLigado,
  avisarAndamento,
  avisarEnvioDoPedido,
  eventoDoWebhook,
  formaQueVence,
  montarAvisoDeAndamento,
} from "../../lib/painel/andamento.ts";
import { montarAvisoDoPedido } from "../../lib/painel/pedido.ts";
import { tratarWebhookDoPedido } from "../../lib/painel/webhookDoPedido.ts";
import { reconcilePaymentReference } from "../../services/payments/reconcile.ts";

const ligado = { PAINEL_AVISAR_ANDAMENTO: "1" };
const pedido = (extra = {}) => ({
  id: 4512, billingPhone: "11988887777", billingEmail: "maria@exemplo.com.br", billingName: "Maria Souza",
  total: "209.40", paymentMethod: "inter_pix", metaData: {},
  entrega: { endereco: null, itens: [], frete: { metodoId: "flat_rate:3", metodo: "Entrega Persi", centavos: 1100 } },
  ...extra,
});

test("desligado por padrão; liga com PAINEL_AVISAR_ANDAMENTO=1", () => {
  assert.equal(andamentoLigado({}), false);
  assert.equal(andamentoLigado({ PAINEL_AVISAR_ANDAMENTO: "0" }), false);
  assert.equal(andamentoLigado(ligado), true);
});

test("o webhook vira andamento: cancelled, completed (ENTREGUE) e refunded; o resto não", () => {
  assert.equal(eventoDoWebhook("cancelled"), "cancelado");
  assert.equal(eventoDoWebhook("completed"), "concluido");
  assert.equal(eventoDoWebhook("refunded"), "reembolsado");
  for (const s of ["failed", "processing", "pending", "on-hold"]) assert.equal(eventoDoWebhook(s), null, s);
});

test("só Pix e boleto 'vencem'", () => {
  assert.equal(formaQueVence("inter_pix"), "pix");
  assert.equal(formaQueVence("inter_boleto"), "boleto");
  assert.equal(formaQueVence("mercadopago_card"), null);
  assert.equal(formaQueVence(undefined), null);
});

test("o aviso de cada evento leva o que o contrato pede", () => {
  const cancelado = montarAvisoDeAndamento(pedido(), "cancelado", {}, {});
  assert.deepEqual(cancelado, {
    tipo: "andamento", telefone: "11988887777", pedido: "4512", evento: "cancelado",
    motivo: "loja", forma_pagamento: "pix", link: "https://persimateriais.com.br/minha-conta/pedidos/4512",
  });
  assert.equal(montarAvisoDeAndamento(pedido(), "cancelado", { motivo: "pagamento_expirado" }, {}).motivo, "pagamento_expirado");
  assert.equal(montarAvisoDeAndamento(pedido(), "concluido", {}, {}).forma_envio, "loja");
  const retirada = pedido({ entrega: { endereco: null, itens: [], frete: { metodoId: "local_pickup:1", metodo: "Retirada" } } });
  assert.equal(montarAvisoDeAndamento(retirada, "concluido", {}, {}).forma_envio, "retirada");
  const reembolso = montarAvisoDeAndamento(pedido({ paymentMethod: "mercadopago_card" }), "reembolsado", {}, {});
  assert.equal(reembolso.valor_centavos, 20940);
  assert.equal(reembolso.forma_pagamento, "cartão");
  const enviado = montarAvisoDeAndamento(pedido(), "enviado", { transportadora: "Correios", rastreio: "AB123456789BR" }, {});
  assert.equal(enviado.transportadora, "Correios");
  assert.equal(enviado.rastreio, "AB123456789BR");
  assert.equal(montarAvisoDeAndamento(pedido({ billingPhone: "" }), "concluido", {}, {}), null);
});

test("desligado: não chama o painel", async () => {
  let chamou = false;
  const r = await avisarAndamento(pedido(), "concluido", {}, { env: {}, enviar: async () => { chamou = true; return { enviado: true, conversa: 1 }; } });
  assert.equal(r.enviado, false);
  assert.equal(chamou, false);
});

test("ligado: chama o painel com o aviso; e nunca lança", async () => {
  const avisos = [];
  const r = await avisarAndamento(pedido(), "concluido", {}, { env: ligado, enviar: async (a) => { avisos.push(a); return { enviado: true, conversa: 1 }; } });
  assert.equal(r.enviado, true);
  assert.equal(avisos[0].tipo, "andamento");
  assert.equal(avisos[0].evento, "concluido");
  const caiu = await avisarAndamento(pedido(), "concluido", {}, { env: ligado, enviar: async () => { throw new Error("boom"); } });
  assert.equal(caiu.enviado, false);
});

test("o envio (para o Melhor Envio chamar) é o andamento 'enviado'", async () => {
  const avisos = [];
  await avisarEnvioDoPedido(pedido(), { transportadora: "Jadlog", rastreio: "JD1234567" },
    { env: ligado, enviar: async (a) => { avisos.push(a); return { enviado: true, conversa: 1 }; } });
  assert.equal(avisos[0].evento, "enviado");
  assert.equal(avisos[0].rastreio, "JD1234567");
});

// O webhook ------------------------------------------------------------------
const SEGREDO = "segredo-do-webhook-de-pedido-de-teste";
const doWebhook = (status) => {
  const corpo = JSON.stringify({ id: 4512, status, total: "209.40", billing: { phone: "11988887777" } });
  return tratarWebhookDoPedido({
    bruto: Buffer.from(corpo), tipoDeConteudo: "application/json", topico: "order.updated", segredo: SEGREDO,
    assinatura: crypto.createHmac("sha256", SEGREDO).update(corpo).digest("base64"),
  });
};

test("webhook completed: o andamento ENTREGUE, e nada para a entrega (status 200)", () => {
  const s = doWebhook("completed");
  assert.equal(s.status, 200);
  assert.equal(s.avisar, undefined);
  assert.equal(s.andamento.evento, "concluido");
  assert.equal(s.andamento.pedido.id, 4512);
});

test("webhook cancelled: o cancelado da entrega (fase 7) E o andamento ao cliente", () => {
  const s = doWebhook("cancelled");
  assert.equal(s.avisar.situacao, "cancelado");
  assert.equal(s.andamento.evento, "cancelado");
});

test("webhook refunded: a entrega cancelada (fase 7) e o andamento é REEMBOLSO", () => {
  const s = doWebhook("refunded");
  assert.equal(s.avisar.situacao, "cancelado");
  assert.equal(s.andamento.evento, "reembolsado");
});

test("webhook failed: só a fase 7; o 'seu Pix venceu' sai da conciliação", () => {
  const s = doWebhook("failed");
  assert.equal(s.avisar.situacao, "cancelado");
  assert.equal(s.andamento, undefined);
});

test("webhook processing: nada (quem conta o pago é a conciliação)", () => {
  const s = doWebhook("processing");
  assert.equal(s.avisar, undefined);
  assert.equal(s.andamento, undefined);
});

// A conciliação --------------------------------------------------------------
test("a conciliação avisa o vencido UMA vez: só quando o pedido MUDA para falho", async () => {
  const vencidos = [];
  const deps = (status) => ({
    findOrder: async () => ({ ...pedido(), status }),
    markPaid: async (o) => o,
    markFailed: async (o) => ({ ...o, status: "failed" }),
    avisarVencido: async (o) => { vencidos.push(o.id); },
  });
  await reconcilePaymentReference("inter", "TX1", "failed", deps("pending"));
  await reconcilePaymentReference("inter", "TX1", "failed", deps("failed"));
  await reconcilePaymentReference("inter", "TX1", "pending", deps("pending"));
  assert.deepEqual(vencidos, [4512]);
});

// O pago completo ------------------------------------------------------------
test("o aviso de pago leva nome e total só com a fase B ligada", () => {
  const sem = montarAvisoDoPedido(pedido(), "pago", {});
  assert.equal(sem.cliente, undefined);
  assert.equal(sem.total_centavos, undefined);
  const com = montarAvisoDoPedido(pedido(), "pago", ligado);
  assert.equal(com.cliente, "Maria Souza");
  assert.equal(com.total_centavos, 20940);
});

test("as ligações: a rota do webhook manda o andamento com after, e a conciliação usa o vencido por padrão", async () => {
  const { readFile } = await import("node:fs/promises");
  const rota = await readFile(new URL("../../app/api/webhooks/woocommerce/pedido/route.ts", import.meta.url), "utf8");
  assert.match(rota, /if \(andamento\) after\(\(\) => avisarAndamento\(andamento\.pedido, andamento\.evento\)/);
  const conciliacao = await readFile(new URL("../../services/payments/reconcile.ts", import.meta.url), "utf8");
  assert.match(conciliacao, /avisarVencido: avisarPagamentoVencido,/);
  assert.match(conciliacao, /if \(!formaQueVence\(order\.paymentMethod\)\) return;/);
});
