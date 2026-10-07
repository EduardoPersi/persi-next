import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// A COBRANÇA PELO WHATSAPP: Pix e boleto de pedido não pago, mandados pelo
// painel de atendimento (contrato no persi-atendimento, §3.2).
import {
  cobrancaLigada,
  cobrancasJaEnviadas,
  centavosDoTotal,
  diaEmSaoPaulo,
  encerraACobranca,
  enviarCobranca,
  momentoDoCron,
  montarAvisoDeCobranca,
  META_COBRANCA_WHATSAPP,
} from "../../lib/painel/cobranca.ts";
import { getPixChargeStatus } from "../../services/payments/inter/pix.ts";
import { COBRANCA_WHATSAPP_META } from "../../services/woocommerce/orders.ts";

const AGORA = new Date("2026-10-06T15:00:00Z"); // 12h em São Paulo
const minutos = (n) => new Date(AGORA.getTime() + n * 60e3).toISOString();
const dias = (n) => diaEmSaoPaulo(new Date(AGORA.getTime() + n * 86400e3));
const ligado = { PAINEL_ENVIAR_COBRANCA: "1" };
const PIX = { forma: "pix", codigo: "00020101021226...6304ABCD", valorCentavos: 20940, venceEm: minutos(60) };
const pedido = (meta = {}) => ({ id: 4512, billingPhone: "11988887777", metaData: { ...meta } });

test("desligada por padrão; liga com PAINEL_ENVIAR_COBRANCA=1 ou true", () => {
  assert.equal(cobrancaLigada({}), false);
  assert.equal(cobrancaLigada({ PAINEL_ENVIAR_COBRANCA: "0" }), false);
  assert.equal(cobrancaLigada({ PAINEL_ENVIAR_COBRANCA: "1" }), true);
  assert.equal(cobrancaLigada({ PAINEL_ENVIAR_COBRANCA: " TRUE " }), true);
});

test("o meta do pedido é o mesmo nos dois lados", () => {
  assert.equal(META_COBRANCA_WHATSAPP, COBRANCA_WHATSAPP_META);
  assert.deepEqual([...cobrancasJaEnviadas({ [META_COBRANCA_WHATSAPP]: "pix:agora, pix:lembrete" })], ["pix:agora", "pix:lembrete"]);
  assert.equal(cobrancasJaEnviadas({}).size, 0);
});

test("o total do WooCommerce vira centavos; zero ou lixo não", () => {
  assert.equal(centavosDoTotal("209.40"), 20940);
  assert.equal(centavosDoTotal("0.00"), null);
  assert.equal(centavosDoTotal("abc"), null);
});

test("cron, Pix: longe de vencer manda o 'agora' que faltou; perto, o lembrete; uma vez cada", () => {
  const nada = new Set();
  assert.equal(momentoDoCron({ forma: "pix", venceEm: minutos(50) }, nada, AGORA), "agora");
  assert.equal(momentoDoCron({ forma: "pix", venceEm: minutos(50) }, new Set(["pix:agora"]), AGORA), null);
  assert.equal(momentoDoCron({ forma: "pix", venceEm: minutos(15) }, new Set(["pix:agora"]), AGORA), "lembrete");
  assert.equal(momentoDoCron({ forma: "pix", venceEm: minutos(20) }, nada, AGORA), "lembrete");
  assert.equal(momentoDoCron({ forma: "pix", venceEm: minutos(15) }, new Set(["pix:agora", "pix:lembrete"]), AGORA), null);
});

test("cron, Pix: vencendo em instantes ou vencido, nada", () => {
  assert.equal(momentoDoCron({ forma: "pix", venceEm: minutos(2) }, new Set(), AGORA), null);
  assert.equal(momentoDoCron({ forma: "pix", venceEm: minutos(-10) }, new Set(), AGORA), null);
  assert.equal(momentoDoCron({ forma: "pix", venceEm: "lixo" }, new Set(), AGORA), null);
});

test("cron, boleto: antes do dia, o 'agora' que faltou; no dia, o lembrete; vencido, nada", () => {
  assert.equal(momentoDoCron({ forma: "boleto", venceEm: dias(2) }, new Set(), AGORA), "agora");
  assert.equal(momentoDoCron({ forma: "boleto", venceEm: dias(2) }, new Set(["boleto:agora"]), AGORA), null);
  assert.equal(momentoDoCron({ forma: "boleto", venceEm: dias(0) }, new Set(["boleto:agora"]), AGORA), "lembrete");
  assert.equal(momentoDoCron({ forma: "boleto", venceEm: dias(0) }, new Set(["boleto:lembrete"]), AGORA), null);
  assert.equal(momentoDoCron({ forma: "boleto", venceEm: dias(-1) }, new Set(), AGORA), null);
  assert.equal(momentoDoCron({ forma: "boleto", venceEm: "" }, new Set(), AGORA), null);
});

test("o dia do boleto é o de São Paulo, não o de Greenwich", () => {
  // 01h UTC de 07/10 ainda é 22h de 06/10 em São Paulo.
  assert.equal(diaEmSaoPaulo(new Date("2026-10-07T01:00:00Z")), "2026-10-06");
});

test("o aviso ao painel leva o que o contrato pede, com o link do pedido", () => {
  const aviso = montarAvisoDeCobranca(pedido(), PIX, "agora");
  assert.deepEqual(aviso, {
    tipo: "cobranca", telefone: "11988887777", pedido: "4512", forma: "pix", momento: "agora",
    codigo: PIX.codigo, valor_centavos: 20940, vence_em: PIX.venceEm,
    link: "https://persimateriais.com.br/minha-conta/pedidos/4512",
  });
  assert.equal(montarAvisoDeCobranca({ id: 1, billingPhone: "" }, PIX, "agora"), null);
  assert.equal(montarAvisoDeCobranca(pedido(), { ...PIX, codigo: "" }, "agora"), null);
});

test("o que encerra a cobrança: enviada e 4xx; o 429, 5xx e a rede tentam de novo", () => {
  assert.equal(encerraACobranca({ enviado: true, conversa: 1 }), true);
  for (const status of [400, 409, 422]) {
    assert.equal(encerraACobranca({ enviado: false, motivo: "x", status, podeTentarDeNovo: false }), true, String(status));
  }
  assert.equal(encerraACobranca({ enviado: false, motivo: "x", status: 429, podeTentarDeNovo: false }), false);
  assert.equal(encerraACobranca({ enviado: false, motivo: "x", status: 502, podeTentarDeNovo: true }), false);
  assert.equal(encerraACobranca({ enviado: false, motivo: "rede", podeTentarDeNovo: true }), false);
});

test("desligada: não chama o painel", async () => {
  let chamou = false;
  const r = await enviarCobranca(pedido(), PIX, "agora", { env: {}, enviar: async () => { chamou = true; return { enviado: true, conversa: 1 }; } });
  assert.equal(r.enviado, false);
  assert.equal(chamou, false);
});

test("enviada: anota no pedido (somando ao que já havia)", async () => {
  const marcas = [];
  const p = pedido({ [META_COBRANCA_WHATSAPP]: "pix:agora" });
  const r = await enviarCobranca(p, PIX, "lembrete", {
    env: ligado,
    enviar: async (aviso) => { assert.equal(aviso.momento, "lembrete"); return { enviado: true, conversa: 7 }; },
    marcar: async (id, valor) => { marcas.push([id, valor]); },
  });
  assert.equal(r.enviado, true);
  assert.deepEqual(marcas, [[4512, "pix:agora,pix:lembrete"]]);
  assert.equal(p.metaData[META_COBRANCA_WHATSAPP], "pix:agora,pix:lembrete");
});

test("já anotada: não chama o painel de novo", async () => {
  let chamou = false;
  const r = await enviarCobranca(pedido({ [META_COBRANCA_WHATSAPP]: "pix:agora" }), PIX, "agora", {
    env: ligado, enviar: async () => { chamou = true; return { enviado: true, conversa: 1 }; }, marcar: async () => {},
  });
  assert.equal(r.enviado, false);
  assert.equal(chamou, false);
});

test("409 do painel (já enviada, pedido pago): anota e não repete", async () => {
  const marcas = [];
  await enviarCobranca(pedido(), PIX, "agora", {
    env: ligado,
    enviar: async () => ({ enviado: false, motivo: "o pedido já está pago", status: 409, codigo: "PEDIDO_PAGO", podeTentarDeNovo: false }),
    marcar: async (id, valor) => { marcas.push(valor); },
  });
  assert.deepEqual(marcas, ["pix:agora"]);
});

test("429 do painel (fora da janela): NÃO anota — a próxima passada tenta de novo", async () => {
  const marcas = [];
  await enviarCobranca(pedido(), { ...PIX, forma: "boleto", venceEm: dias(0) }, "lembrete", {
    env: ligado,
    enviar: async () => ({ enviado: false, motivo: "fora da janela de envio", status: 429, podeTentarDeNovo: false }),
    marcar: async (id, valor) => { marcas.push(valor); },
  });
  assert.deepEqual(marcas, []);
});

test("nada lança: nem o painel caindo, nem o WooCommerce recusando a anotação", async () => {
  const caiu = await enviarCobranca(pedido(), PIX, "agora", {
    env: ligado, enviar: async () => { throw new Error("boom"); }, marcar: async () => {},
  });
  assert.equal(caiu.enviado, false);
  assert.equal(caiu.podeTentarDeNovo, true);
  const semAnotar = await enviarCobranca(pedido(), PIX, "agora", {
    env: ligado, enviar: async () => ({ enviado: true, conversa: 1 }), marcar: async () => { throw new Error("woo fora"); },
  });
  assert.equal(semAnotar.enviado, true);
});

test("a consulta do Pix devolve também o copia e cola (o lembrete usa daqui)", async () => {
  const r = await getPixChargeStatus("TX9", async () => ({
    txid: "TX9", status: "ATIVA", calendario: { criacao: "2026-10-06T15:00:00Z", expiracao: 3600 }, pixCopiaECola: "000201abc",
  }));
  assert.equal(r.qrCodeCopyPaste, "000201abc");
  const semCodigo = await getPixChargeStatus("TX9", async () => ({
    txid: "TX9", status: "ATIVA", calendario: { criacao: "2026-10-06T15:00:00Z", expiracao: 3600 },
  }));
  assert.equal(semCodigo.qrCodeCopyPaste, "");
});

test("o checkout manda o Pix e o boleto depois da resposta, e nunca o cartão", async () => {
  const fonte = await readFile(new URL("../../app/api/checkout/payment/route.ts", import.meta.url), "utf8");
  const pix = fonte.indexOf('after(() => enviarCobranca(order, pixDoWhatsapp, "agora")');
  const boleto = fonte.indexOf('after(() => enviarCobranca(order, boletoDoWhatsapp, "agora")');
  const cartao = fonte.indexOf('} else if (input.method === "mercadopago_card") {');
  assert.ok(pix > 0 && boleto > pix && cartao > boleto, "Pix e boleto antes do bloco do cartão");
  assert.equal(fonte.split("enviarCobranca(").length - 1, 2, "só dois envios no checkout");
  assert.match(fonte.slice(boleto - 400, boleto), /if \(charge\.digitableLine && charge\.dueDate\)/);
});

test("o cron só lembra com a cobrança ainda pendente no banco, e manda depois da resposta", async () => {
  const fonte = await readFile(new URL("../../app/api/cron/expire-pending-payments/route.ts", import.meta.url), "utf8");
  assert.equal(fonte.split('if (category === "pending") {').length - 1, 2);
  assert.match(fonte, /after\(async \(\) => \{\s*for \(const \{ order, cobranca, momento \} of lembrar\)/);
  assert.match(fonte, /if \(!cobrancaLigada\(\)\) return null;/);
});
