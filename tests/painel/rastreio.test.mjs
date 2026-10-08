import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

// Fase 0 do Melhor Envio: o plugin do WordPress grava o código de rastreio no
// pedido; o webhook "Pedido atualizado" traz isso ao site, e o cliente recebe o
// "enviado" pelo WhatsApp. Aqui: a leitura do código, quando avisar e o webhook.
import { rastreiosDoPedido, urlDoRastreio } from "../../lib/rastreio/melhorEnvio.ts";
import { envioParaAviso, statusSemAvisoDeEnvio } from "../../lib/painel/rastreio.ts";
import { montarAvisoDeAndamento } from "../../lib/painel/andamento.ts";
import { tratarWebhookDoPedido } from "../../lib/painel/webhookDoPedido.ts";

const META = "_melhor_envio_tracking_codes";
const meta = (value) => [{ key: META, value }];

test("lê a lista de códigos que o plugin grava, na ordem e sem repetir", () => {
  assert.deepEqual(rastreiosDoPedido(meta(["AB123456789BR", "CD987654321BR", "AB123456789BR"])), [
    "AB123456789BR",
    "CD987654321BR",
  ]);
});

test("aceita um código solto (instalações antigas) e tira espaços", () => {
  assert.deepEqual(rastreiosDoPedido(meta("  AB123456789BR ")), ["AB123456789BR"]);
  assert.deepEqual(rastreiosDoPedido(meta(["AB 123456789 BR"])), ["AB123456789BR"]);
});

test("ignora o que não é código: lixo, link, texto serializado do PHP, tipo errado", () => {
  assert.deepEqual(rastreiosDoPedido(meta(["https://golpe.com/pague"])), []);
  assert.deepEqual(rastreiosDoPedido(meta('a:1:{i:0;s:13:"AB123456789BR";}')), []);
  assert.deepEqual(rastreiosDoPedido(meta(["curto", 123456789, null, { a: 1 }])), []);
  assert.deepEqual(rastreiosDoPedido(meta("")), []);
  assert.deepEqual(rastreiosDoPedido(undefined), []);
  assert.deepEqual(rastreiosDoPedido([{ key: "_outro_meta", value: ["AB123456789BR"] }]), []);
});

test("guarda no máximo 5 códigos", () => {
  const muitos = Array.from({ length: 9 }, (_, i) => `CODIGO00000${i}`);
  assert.equal(rastreiosDoPedido(meta(muitos)).length, 5);
});

test("o link de acompanhamento codifica o código", () => {
  assert.equal(urlDoRastreio("AB123456789BR"), "https://www.melhorrastreio.com.br/meu-rastreio/AB123456789BR");
  assert.equal(urlDoRastreio("a b"), "https://www.melhorrastreio.com.br/meu-rastreio/a%20b");
});

const frete = (metodoId, metodo = "PAC") => ({ endereco: null, itens: [], frete: { metodoId, metodo } });
const pedidoCom = (extra = {}) => ({
  status: "processing",
  rastreios: ["AB123456789BR"],
  entrega: frete("melhor_envio_1"),
  ...extra,
});

test("avisa o pedido de transportadora com código, e leva o nome do frete", () => {
  assert.deepEqual(envioParaAviso(pedidoCom(), {}), { rastreio: "AB123456789BR", transportadora: "PAC" });
});

test("sem código de rastreio, não avisa", () => {
  assert.equal(envioParaAviso(pedidoCom({ rastreios: [] }), {}), null);
  assert.equal(envioParaAviso(pedidoCom({ rastreios: undefined }), {}), null);
});

test("só o primeiro código vai no aviso", () => {
  const envio = envioParaAviso(pedidoCom({ rastreios: ["AAAAAA111111", "BBBBBB222222"] }), {});
  assert.equal(envio.rastreio, "AAAAAA111111");
});

test("status que não devem avisar: pendente, falho, cancelado, reembolsado e concluído", () => {
  for (const status of ["pending", "failed", "cancelled", "refunded", "completed", "trash"]) {
    assert.equal(envioParaAviso(pedidoCom({ status }), {}), null, status);
  }
  for (const status of ["processing", "on-hold", "enviado", "em-transporte"]) {
    assert.ok(envioParaAviso(pedidoCom({ status }), {}), status);
  }
});

test("a lista de status sem aviso troca pelo ambiente (PAINEL_ENVIO_STATUS_SEM_AVISO)", () => {
  const env = { PAINEL_ENVIO_STATUS_SEM_AVISO: "on-hold, Completed" };
  assert.deepEqual(statusSemAvisoDeEnvio(env), ["on-hold", "completed"]);
  assert.equal(envioParaAviso(pedidoCom({ status: "on-hold" }), env), null);
  assert.ok(envioParaAviso(pedidoCom({ status: "pending" }), env));
});

test("entrega da loja e retirada não passam por este aviso", () => {
  assert.equal(envioParaAviso(pedidoCom({ entrega: frete("flat_rate") }), {}), null);
  assert.equal(envioParaAviso(pedidoCom({ entrega: frete("free_shipping") }), {}), null);
  assert.equal(envioParaAviso(pedidoCom({ entrega: frete("local_pickup") }), {}), null);
  assert.ok(envioParaAviso(pedidoCom({ entrega: frete("melhor_envio_2") }), {}));
});

test("sem dados de frete, o código do Melhor Envio basta (e o nome fica de fora)", () => {
  assert.deepEqual(envioParaAviso(pedidoCom({ entrega: undefined }), {}), { rastreio: "AB123456789BR" });
});

test("o nome da transportadora é cortado em 60 caracteres", () => {
  const envio = envioParaAviso(pedidoCom({ entrega: frete("melhor_envio_1", "X".repeat(200)) }), {});
  assert.equal(envio.transportadora.length, 60);
});

test("o aviso ao painel leva evento enviado, transportadora e rastreio", () => {
  const aviso = montarAvisoDeAndamento(
    { id: 31200, billingPhone: "11988887777", entrega: frete("melhor_envio_1") },
    "enviado",
    { transportadora: "PAC", rastreio: "AB123456789BR" },
    {},
  );
  assert.equal(aviso.tipo, "andamento");
  assert.equal(aviso.evento, "enviado");
  assert.equal(aviso.pedido, "31200");
  assert.equal(aviso.transportadora, "PAC");
  assert.equal(aviso.rastreio, "AB123456789BR");
});

// ----- o webhook de ponta a ponta -----

const SEGREDO = "segredo-do-webhook-de-pedido-de-teste";
const assinar = (corpo) => crypto.createHmac("sha256", SEGREDO).update(corpo).digest("base64");
const entrada = (corpo) => ({
  bruto: Buffer.from(corpo),
  tipoDeConteudo: "application/json",
  assinatura: assinar(corpo),
  topico: "order.updated",
  segredo: SEGREDO,
});
const payload = (status, extra = {}) =>
  JSON.stringify({
    id: 31200,
    status,
    total: "209.40",
    currency: "BRL",
    billing: { phone: "11988887777" },
    shipping: { address_1: "Rua do Retiro", postcode: "13201-000" },
    shipping_lines: [{ method_id: "melhor_envio_1", method_title: "PAC", total: "20.00" }],
    meta_data: [{ key: META, value: ["AB123456789BR"] }],
    ...extra,
  });

test("webhook com rastreio num pedido em andamento: 200 e o envio para avisar", () => {
  const saida = tratarWebhookDoPedido(entrada(payload("processing")));
  assert.equal(saida.status, 200);
  assert.equal(saida.corpo.ignorado, false);
  assert.equal(saida.envio.pedido.id, 31200);
  assert.equal(saida.envio.envio.rastreio, "AB123456789BR");
  assert.equal(saida.envio.envio.transportadora, "PAC");
  assert.equal(saida.avisar, undefined);
});

test("webhook concluído com rastreio: só o 'entregue', sem 'enviado' depois dele", () => {
  const saida = tratarWebhookDoPedido(entrada(payload("completed")));
  assert.equal(saida.envio, undefined);
  assert.equal(saida.andamento.evento, "concluido");
});

test("webhook cancelado com rastreio: cancela, e não avisa 'enviado'", () => {
  const saida = tratarWebhookDoPedido(entrada(payload("cancelled")));
  assert.equal(saida.status, 202);
  assert.equal(saida.envio, undefined);
  assert.equal(saida.andamento.evento, "cancelado");
});

test("webhook sem o meta de rastreio não avisa envio", () => {
  const saida = tratarWebhookDoPedido(entrada(payload("processing", { meta_data: [] })));
  assert.equal(saida.envio, undefined);
  assert.equal(saida.corpo.ignorado, true);
});

test("webhook com assinatura errada não leva nenhum envio", () => {
  const saida = tratarWebhookDoPedido({ ...entrada(payload("processing")), assinatura: "errada" });
  assert.equal(saida.status, 401);
  assert.equal(saida.envio, undefined);
});

test("a rota agenda o aviso de envio depois de responder ao WooCommerce", async () => {
  const rota = await readFile(new URL("../../app/api/webhooks/woocommerce/pedido/route.ts", import.meta.url), "utf8");
  assert.match(rota, /avisarEnvioDoPedido/);
  assert.match(rota, /after\(\(\) => avisarEnvioDoPedido\(envio\.pedido, envio\.envio\)/);
});
