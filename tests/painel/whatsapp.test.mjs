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

// AS TRÊS COMBINAÇÕES DE "NÃO CONFIGURADO", uma por uma.
//
// É esta conferência que sustenta a decisão de deixar PAINEL_URL e
// SITE_WEBHOOK_KEY vazias no site enquanto o aviso de pedido não é revisado:
// com qualquer uma vazia, o site NÃO fala com o painel. Conferir só uma das
// duas deixaria a outra metade da promessa sem prova.
for (const [nome, vazias] of [
  ["sem a chave", ["SITE_WEBHOOK_KEY"]],
  ["sem o endereço", ["PAINEL_URL"]],
  ["sem as duas", ["PAINEL_URL", "SITE_WEBHOOK_KEY"]],
]) {
  test(`${nome}, não chama ninguém`, async () => {
    let chamou = false;
    globalThis.fetch = async () => { chamou = true; return { ok: true, status: 201, json: async () => ({}) }; };
    process.env.PAINEL_URL = "https://painel.exemplo/";
    process.env.SITE_WEBHOOK_KEY = "chave-de-teste-com-tamanho-suficiente";
    for (const v of vazias) delete process.env[v];

    // Os DOIS avisos que existem, e não só o de pedido: o de código de acesso
    // ainda não tem chamador, e no dia em que tiver não pode ser o caminho que
    // escapa da guarda.
    for (const aviso of [
      { tipo: "pedido", telefone: "11999998888", pedido: "1", status: "ok" },
      { tipo: "codigo_acesso", telefone: "11999998888", codigo: "A1B2C3" },
    ]) {
      const r = await avisarPeloWhatsapp(aviso);
      assert.equal(chamou, false, `${aviso.tipo} chamou mesmo ${nome}`);
      assert.equal(r.enviado, false);
      assert.equal(r.podeTentarDeNovo, false);
    }

    process.env.PAINEL_URL = "https://painel.exemplo/";
    process.env.SITE_WEBHOOK_KEY = "chave-de-teste-com-tamanho-suficiente";
  });
}

test("e só UM módulo do site sabe falar com o painel", async () => {
  // A guarda acima vale enquanto todo o site passar por `lib/painel/`. Um
  // `fetch` para o painel escrito direto em outro arquivo passaria por fora
  // dela, e a promessa de "vazias = ninguém chama" deixaria de valer sem
  // ninguém notar.
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const raiz = new URL("../../", import.meta.url).pathname;
  const porFora = [];
  const pular = new Set(["node_modules", ".next", ".git", "tests", "wordpress-plugin"]);

  const varrer = async (dir) => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (pular.has(item.name)) continue;
      const caminho = join(dir, item.name);
      if (item.isDirectory()) { await varrer(caminho); continue; }
      if (!/\.tsx?$/.test(item.name)) continue;
      if (caminho.includes("/lib/painel/")) continue;
      const texto = await readFile(caminho, "utf8");
      if (/PAINEL_URL|api\/webhooks\/site\/notificar/.test(texto)) {
        porFora.push(caminho.replace(raiz, ""));
      }
    }
  };
  await varrer(raiz);
  assert.deepEqual(porFora, [], `falam com o painel por fora de lib/painel: ${porFora.join(", ")}`);
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
