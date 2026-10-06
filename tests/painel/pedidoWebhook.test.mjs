import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

// O webhook "Pedido atualizado" do WooCommerce (fase 7 do painel): quem entra,
// o "ping" que ativa o webhook, e o que vai ao painel — só o cancelamento.
import { tratarWebhookDoPedido } from "../../lib/painel/webhookDoPedido.ts";

const SEGREDO = "segredo-do-webhook-de-pedido-de-teste";
const assinar = (corpo) => crypto.createHmac("sha256", SEGREDO).update(corpo).digest("base64");
const entrada = (corpo, extra = {}) => ({
  bruto: Buffer.from(corpo),
  tipoDeConteudo: "application/json",
  assinatura: assinar(corpo),
  topico: "order.updated",
  segredo: SEGREDO,
  ...extra,
});
const pedido = (status) => JSON.stringify({
  id: 4512, status, total: "209.40", currency: "BRL",
  billing: { phone: "11988887777" },
  shipping: { address_1: "Rua do Retiro", postcode: "13201-000" },
});

test("sem segredo configurado: 503 (fechado, nunca aberto)", () => {
  assert.equal(tratarWebhookDoPedido(entrada(pedido("cancelled"), { segredo: "" })).status, 503);
});

test("o ping do WooCommerce (formulário, sem assinatura nem tópico) responde 200", () => {
  const s = tratarWebhookDoPedido(entrada("webhook_id=12", {
    tipoDeConteudo: "application/x-www-form-urlencoded", assinatura: null, topico: null,
  }));
  assert.equal(s.status, 200);
  assert.equal(s.avisar, undefined);
});

test("um formulário que não é o ping NÃO passa sem assinatura", () => {
  const s = tratarWebhookDoPedido(entrada("webhook_id=12&status=cancelled", {
    tipoDeConteudo: "application/x-www-form-urlencoded", assinatura: null,
  }));
  assert.equal(s.status, 401);
});

test("assinatura errada ou ausente: 401, e nada vai ao painel", () => {
  for (const assinatura of ["errada", null]) {
    const s = tratarWebhookDoPedido(entrada(pedido("cancelled"), { assinatura }));
    assert.equal(s.status, 401);
    assert.equal(s.avisar, undefined);
  }
});

test("assinatura de OUTRO corpo não vale", () => {
  const s = tratarWebhookDoPedido(entrada(pedido("cancelled"), { assinatura: assinar(pedido("processing")) }));
  assert.equal(s.status, 401);
});

test("outro tópico é ignorado", () => {
  const s = tratarWebhookDoPedido(entrada(pedido("cancelled"), { topico: "order.created" }));
  assert.equal(s.status, 200);
  assert.equal(s.avisar, undefined);
});

test("pago pelo webhook NÃO vai ao painel (quem conta o pago é a conciliação)", () => {
  for (const status of ["processing", "completed", "pending"]) {
    const s = tratarWebhookDoPedido(entrada(pedido(status)));
    assert.equal(s.status, 200, status);
    assert.equal(s.avisar, undefined, status);
  }
});

test("cancelado, reembolsado ou falho: 202 e o aviso de CANCELADO, com o pedido", () => {
  for (const status of ["cancelled", "refunded", "failed"]) {
    const s = tratarWebhookDoPedido(entrada(pedido(status)));
    assert.equal(s.status, 202, status);
    assert.equal(s.avisar.situacao, "cancelado");
    assert.equal(s.avisar.pedido.id, 4512);
    assert.equal(s.avisar.pedido.billingPhone, "11988887777");
  }
});

test("corpo que não é pedido: 422; JSON torto: 400; grande demais: 413", () => {
  assert.equal(tratarWebhookDoPedido(entrada(JSON.stringify({ nada: 1 }))).status, 422);
  assert.equal(tratarWebhookDoPedido(entrada("{torto")).status, 400);
  assert.equal(tratarWebhookDoPedido(entrada("x".repeat(262145))).status, 413);
});

test("a rota é só a casca: usa a regra, agenda com after e lê o segredo do ambiente", async () => {
  const fonte = await readFile(new URL("../../app/api/webhooks/woocommerce/pedido/route.ts", import.meta.url), "utf8");
  assert.match(fonte, /tratarWebhookDoPedido\(/);
  assert.match(fonte, /after\(\(\) => avisarSituacaoDoPedido\(/);
  assert.match(fonte, /PAINEL_WOO_PEDIDO_WEBHOOK_SECRET/);
});
