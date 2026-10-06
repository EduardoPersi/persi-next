import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { configDoLead, enviarLeadAoPainel, montarCorpoDoLead } from "../lib/painel/lead.ts";

const EMPRESA = "persi-gesso";
const CHAVE = "persi_chave-de-mentira-para-testes-0123456789";

// Painel de mentira DENTRO do teste: só o contrato, para o teste não depender
// de outro repositório. Se PAINEL_FAKE_SCRIPT apontar para o fake oficial
// (persi-atendimento/testes/fakes/painel-rastreio.mjs), o mesmo conjunto roda
// também contra ele (ver abaixo).
function criarPainel() {
  const estado = { leads: [], testes: 0 };
  const servidor = http.createServer(async (req, res) => {
    const json = (s, c) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(c)); };
    if (req.url === "/lenta") return; // nunca responde
    if (req.method !== "POST" || req.url !== "/api/webhooks/site/lead") return json(404, {});
    if (req.headers["x-persi-empresa"] !== EMPRESA || req.headers["x-persi-chave"] !== CHAVE) return json(401, { error: "credencial inválida" });
    let corpo = ""; for await (const p of req) corpo += p;
    let b; try { b = JSON.parse(corpo); } catch { return json(400, { error: "payload inválido" }); }
    if (!b.contato?.telefone && !b.contato?.email) return json(400, { error: "payload inválido", campos: ["contato"] });
    if (req.headers["x-persi-teste"] === "1") { estado.testes++; return json(200, { ok: true, teste: true }); }
    estado.leads.push({ corpo: b, cabecalhos: req.headers });
    return json(201, { cliente_id: "1", oportunidade_id: "2" });
  });
  return { servidor, estado };
}

let painel;
let url;
before(async () => {
  painel = criarPainel();
  await new Promise((ok) => painel.servidor.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${painel.servidor.address().port}`;
});
after(() => painel.servidor.close());

const config = () => ({ url, empresa: EMPRESA, chave: CHAVE });
const corpoValido = () =>
  montarCorpoDoLead({
    contato: { nome: "Maria", email: "maria@exemplo.com", mensagem: "[Dúvidas] preciso de orçamento de forro" },
    origem: { ultimo_toque: { utm_source: "google", em: "2026-10-04T00:00:00.000Z" } },
    pagina: "https://persimateriais.com.br/contato",
    formulario: "Contato do site",
  });

test("corpo do contrato: tipo, contato, origem, pagina, formulario; sem consentimento por padrão", () => {
  const c = corpoValido();
  assert.equal(c.tipo, "formulario");
  assert.equal(c.contato.email, "maria@exemplo.com");
  assert.equal("consentimento_marketing" in c, false, "omitido = não consentiu");
  assert.equal(montarCorpoDoLead({ contato: { email: "a@b.co" }, consentimentoMarketing: false }).consentimento_marketing, undefined);
  assert.equal(montarCorpoDoLead({ contato: { email: "a@b.co" }, consentimentoMarketing: true }).consentimento_marketing, true);
});

test("corpo: campos vazios somem e os tetos do contrato são respeitados", () => {
  const c = montarCorpoDoLead({ contato: { nome: "  ", email: "a@b.co", mensagem: "m".repeat(5000) } });
  assert.deepEqual(Object.keys(c.contato).sort(), ["email", "mensagem"]);
  assert.equal(c.contato.mensagem.length, 2000);
});

test("configDoLead: exige as três variáveis só do servidor", () => {
  assert.equal(configDoLead({}), null);
  assert.equal(configDoLead({ PAINEL_URL: "x", PAINEL_EMPRESA_SLUG: "y" }), null);
  assert.deepEqual(configDoLead({ PAINEL_URL: "https://p.com/", PAINEL_EMPRESA_SLUG: "e", PAINEL_LEAD_CHAVE: "k" }), { url: "https://p.com", empresa: "e", chave: "k" });
});

test("201: manda os cabeçalhos do contrato e o corpo", async () => {
  const r = await enviarLeadAoPainel(corpoValido(), { config: config() });
  assert.deepEqual(r, { enviado: true, status: 201, teste: false });
  const visto = painel.estado.leads.at(-1);
  assert.equal(visto.cabecalhos["x-persi-empresa"], EMPRESA);
  assert.equal(visto.cabecalhos["x-persi-chave"], CHAVE);
  assert.equal(visto.cabecalhos["x-persi-teste"], undefined);
  assert.equal(visto.corpo.origem.ultimo_toque.utm_source, "google");
});

test("modo teste manda X-Persi-Teste: 1 e o painel não grava", async () => {
  const antes = painel.estado.leads.length;
  const r = await enviarLeadAoPainel(corpoValido(), { config: config(), teste: true });
  assert.deepEqual(r, { enviado: true, status: 200, teste: true });
  assert.equal(painel.estado.leads.length, antes);
  assert.equal(painel.estado.testes >= 1, true);
});

test("400: payload inválido não lança e devolve o status", async () => {
  const logs = [];
  const original = console.error; console.error = (m) => logs.push(m);
  try {
    const r = await enviarLeadAoPainel({ tipo: "formulario", contato: {} }, { config: config() });
    assert.equal(r.enviado, false);
    assert.equal(r.status, 400);
  } finally { console.error = original; }
  assert.equal(logs.length, 1);
});

test("401: chave errada não lança, e o log não tem dado pessoal nem a chave", async () => {
  const logs = [];
  const original = console.error; console.error = (m) => logs.push(String(m));
  try {
    const r = await enviarLeadAoPainel(corpoValido(), { config: { ...config(), chave: "chave-errada-xxxxxxxxxxxxxxxx" } });
    assert.equal(r.enviado, false);
    assert.equal(r.status, 401);
  } finally { console.error = original; }
  const log = logs.join("\n");
  assert.ok(log.includes("401"));
  for (const sensivel of ["maria", "exemplo.com", "orçamento", "chave-errada", CHAVE]) {
    assert.ok(!log.includes(sensivel), `o log vazou: ${sensivel}`);
  }
});

test("painel fora do ar (conexão recusada) não lança", async () => {
  const original = console.error; console.error = () => {};
  try {
    const r = await enviarLeadAoPainel(corpoValido(), { config: { ...config(), url: "http://127.0.0.1:1" } });
    assert.equal(r.enviado, false);
    assert.match(r.motivo, /não consegui falar/);
  } finally { console.error = original; }
});

test("painel que não responde: estoura o tempo curto e não lança", async () => {
  const original = console.error; console.error = () => {};
  const inicio = Date.now();
  try {
    const r = await enviarLeadAoPainel(corpoValido(), {
      config: config(),
      tempoLimiteMs: 300,
      // /lenta é o caminho que o painel de mentira deixa sem resposta.
      fetchImpl: (u, o) => fetch(`${url}/lenta`, o),
    });
    assert.equal(r.enviado, false);
    assert.match(r.motivo, /demorou demais/);
  } finally { console.error = original; }
  assert.ok(Date.now() - inicio < 2000, "não pode esperar além do limite");
});

test("sem configuração não chama o painel", async () => {
  let chamou = false;
  const r = await enviarLeadAoPainel(corpoValido(), { config: null, fetchImpl: async () => { chamou = true; return new Response("{}"); } });
  assert.equal(chamou, false);
  assert.equal(r.enviado, false);
});

// --- Contra o FAKE OFICIAL do painel (opcional) -----------------------------
// PAINEL_FAKE_SCRIPT=/caminho/persi-atendimento/testes/fakes/painel-rastreio.mjs npm test
test("painel de mentira OFICIAL: 201, 400 e 401", { skip: !process.env.PAINEL_FAKE_SCRIPT }, async () => {
  const porta = 3399;
  const filho = spawn(process.execPath, [process.env.PAINEL_FAKE_SCRIPT, String(porta)], { stdio: "ignore" });
  try {
    await new Promise((ok) => setTimeout(ok, 700));
    const cfg = { url: `http://127.0.0.1:${porta}`, empresa: EMPRESA, chave: CHAVE };
    const original = console.error; console.error = () => {};
    try {
      assert.equal((await enviarLeadAoPainel(corpoValido(), { config: cfg })).status, 201);
      assert.equal((await enviarLeadAoPainel({ tipo: "formulario", contato: {} }, { config: cfg })).status, 400);
      assert.equal((await enviarLeadAoPainel(corpoValido(), { config: { ...cfg, chave: "errada" } })).status, 401);
    } finally { console.error = original; }
    const estado = await (await fetch(`${cfg.url}/__estado`)).json();
    assert.equal(estado.leads.length, 1);
    assert.equal(estado.leads[0].origem.ultimo_toque.utm_source, "google");
  } finally { filho.kill(); }
});
