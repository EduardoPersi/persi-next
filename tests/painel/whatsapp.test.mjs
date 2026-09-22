import { test } from "node:test";
import assert from "node:assert/strict";

// Bate contra um painel de mentira: o que se prova aqui é o comportamento —
// o que o módulo manda, e o que ele faz quando o painel recusa ou some.
import { avisarPeloWhatsapp, gerarCodigoDeAcesso } from "../../lib/painel/whatsapp.ts";

test("manda o corpo e o cabeçalho que o painel espera", async () => {
  let visto = null;
  globalThis.fetch = async (url, opcoes) => {
    visto = { url, ...opcoes };
    return { ok: true, status: 201, json: async () => ({ ok: true, conversa: 7 }) };
  };
  process.env.PAINEL_URL = "https://painel.exemplo/";
  process.env.SITE_WEBHOOK_KEY = "chave-de-teste-com-tamanho-suficiente";

  const r = await avisarPeloWhatsapp({ tipo: "codigo_acesso", telefone: "11999998888", codigo: "A1B2C3" });
  assert.deepEqual(r, { enviado: true, conversa: 7 });
  assert.equal(visto.url, "https://painel.exemplo/api/webhooks/site/notificar");
  assert.equal(visto.headers["X-Site-Webhook-Key"], "chave-de-teste-com-tamanho-suficiente");
  assert.deepEqual(JSON.parse(visto.body), { tipo: "codigo_acesso", telefone: "11999998888", codigo: "A1B2C3" });
});

test("painel fora do ar não estoura, e diz que vale tentar de novo", async () => {
  globalThis.fetch = async () => { throw new Error("connect ECONNREFUSED"); };
  const r = await avisarPeloWhatsapp({ tipo: "pedido", telefone: "11999998888", pedido: "1", status: "ok" });
  assert.equal(r.enviado, false);
  assert.equal(r.podeTentarDeNovo, true);
});

test("chave errada não vale tentar de novo", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "chave inválida" }) });
  const r = await avisarPeloWhatsapp({ tipo: "pedido", telefone: "11999998888", pedido: "1", status: "ok" });
  assert.equal(r.enviado, false);
  assert.equal(r.motivo, "chave inválida");
  assert.equal(r.podeTentarDeNovo, false);
});

test("painel com problema vale tentar de novo", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: "fora do ar" }) });
  const r = await avisarPeloWhatsapp({ tipo: "pedido", telefone: "11999998888", pedido: "1", status: "ok" });
  assert.equal(r.podeTentarDeNovo, true);
});

test("sem configuração, não chama ninguém", async () => {
  let chamou = false;
  globalThis.fetch = async () => { chamou = true; return { ok: true, status: 201, json: async () => ({}) }; };
  delete process.env.SITE_WEBHOOK_KEY;
  const r = await avisarPeloWhatsapp({ tipo: "pedido", telefone: "11999998888", pedido: "1", status: "ok" });
  assert.equal(chamou, false);
  assert.equal(r.enviado, false);
  assert.equal(r.podeTentarDeNovo, false);
  process.env.SITE_WEBHOOK_KEY = "chave-de-teste-com-tamanho-suficiente";
});

test("o código é sorteado de verdade e sem letra ambígua", () => {
  const vistos = new Set();
  for (let i = 0; i < 400; i++) {
    const c = gerarCodigoDeAcesso();
    assert.match(c, /^[A-HJ-NP-Z2-9]{6}$/, `código com caractere ambíguo: ${c}`);
    vistos.add(c);
  }
  // 400 sorteios num espaço de 32^6: repetir seria sinal de gerador quebrado.
  assert.ok(vistos.size > 395, `só ${vistos.size} códigos diferentes em 400`);
});
