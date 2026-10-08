import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buscarRecuperacao,
  ehRoboDeLink,
  interpretarRecuperacao,
  planejarRecuperacao,
  recuperacaoLigada,
  tokenDeRecuperacaoValido,
} from "../lib/painel/recuperar.ts";
import { recriarCarrinho } from "../lib/painel/recuperarCarrinho.ts";
import { lerRecuperacao, serializarRecuperacao } from "../lib/painel/recuperarCookie.ts";

const read = (path) => readFileSync(path, "utf8");

const TOKEN = "Qm9yYSBwcmEgY2Fycm8gZGUgdGVzdGUgY29tIDQzIGNhcmFjdGVyZXM";
const ENV = { PAINEL_URL: "https://painel.exemplo.com/", SITE_WEBHOOK_KEY: "chave-secreta" };

// ---------- robôs ----------
test("robôs (prévia do WhatsApp, Facebook, buscadores, HEAD, sem identificação) não são pessoas", () => {
  for (const agente of [
    "WhatsApp/2.23.20.0 A",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "TelegramBot (like TwitterBot)",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0",
    "curl/8.4.0",
    "",
  ]) {
    assert.equal(ehRoboDeLink(agente, "GET"), true, `deveria ser robô: ${agente}`);
  }
  assert.equal(ehRoboDeLink(null, "GET"), true);
  assert.equal(
    ehRoboDeLink("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "HEAD"),
    true,
  );
});

test("navegadores de pessoas passam", () => {
  for (const agente of [
    "Mozilla/5.0 (Linux; Android 13; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  ]) {
    assert.equal(ehRoboDeLink(agente, "GET"), false, `deveria ser pessoa: ${agente}`);
  }
});

// ---------- token e flag ----------
test("formato do token e flag desligada por padrão", () => {
  assert.equal(tokenDeRecuperacaoValido(TOKEN), true);
  assert.equal(tokenDeRecuperacaoValido("curto"), false);
  assert.equal(tokenDeRecuperacaoValido("../../etc/passwd"), false);
  assert.equal(tokenDeRecuperacaoValido(`${TOKEN}<script>`), false);
  assert.equal(recuperacaoLigada({}), false);
  assert.equal(recuperacaoLigada({ PAINEL_RECUPERAR_CARRINHO: "0" }), false);
  assert.equal(recuperacaoLigada({ PAINEL_RECUPERAR_CARRINHO: "1" }), true);
  assert.match(read(".env.example"), /^PAINEL_RECUPERAR_CARRINHO=0$/m);
});

// ---------- resposta do CRM ----------
test("interpreta a resposta do contrato e descarta o que está fora dele", () => {
  const dados = interpretarRecuperacao({
    ok: true,
    expira_em: "2026-11-07T14:03:22.000Z",
    contato: { nome: "Maria Souza", telefone: "5511987654321", cep: "13201000" },
    itens: [
      { produto_id: 4821, variacao_id: null, sku: "CAN", quantidade: 2 },
      { produto_id: 5120, variacao_id: 5120, quantidade: 1, variacao: [{ atributo: "Cor", valor: "Branco" }] },
      { produto_id: -1, quantidade: 1 },
      { produto_id: 9, quantidade: 0 },
      { produto_id: 10, quantidade: 5000 },
      "lixo",
    ],
    cupom: "VOLTA10",
  });
  assert.deepEqual(dados.itens, [
    { id: 4821, quantidade: 2 },
    { id: 5120, quantidade: 1, variacao: [{ attribute: "Cor", value: "Branco" }] },
    { id: 10, quantidade: 999 },
  ]);
  assert.equal(dados.cupom, "VOLTA10");
  assert.equal(dados.contato.cep, "13201000");
  assert.equal(interpretarRecuperacao({ ok: false }), null);
  assert.equal(interpretarRecuperacao({ ok: true }), null);
  assert.equal(interpretarRecuperacao(null), null);
  assert.equal(interpretarRecuperacao({ ok: true, itens: [], cupom: "" }).cupom, null);
});

test("token inválido, expirado, já comprado, chave errada e CRM fora do ar dão a MESMA resposta (null)", async () => {
  const corpo = (status) => async () => ({
    status,
    ok: status === 200,
    json: async () => ({ ok: false, codigo: "qualquer" }),
  });
  const respostas = [];
  for (const status of [404, 410, 409, 401, 429, 500, 502]) {
    respostas.push(await buscarRecuperacao(TOKEN, { env: ENV, fetchImpl: corpo(status) }));
  }
  respostas.push(
    await buscarRecuperacao(TOKEN, {
      env: ENV,
      fetchImpl: async () => {
        throw new Error("rede");
      },
    }),
  );
  respostas.push(await buscarRecuperacao(TOKEN, { env: {}, fetchImpl: corpo(200) }));
  respostas.push(
    await buscarRecuperacao(TOKEN, {
      env: ENV,
      fetchImpl: async () => ({ status: 200, ok: true, json: async () => "não é json do contrato" }),
    }),
  );
  for (const resposta of respostas) assert.equal(resposta, null);
});

test("chamada ao CRM: chave no cabeçalho, token só no corpo, nada no log", async () => {
  const registros = [];
  const originais = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const nome of Object.keys(originais)) console[nome] = (...args) => registros.push(args.join(" "));
  const chamadas = [];
  try {
    const dados = await buscarRecuperacao(TOKEN, {
      env: ENV,
      fetchImpl: async (url, init) => {
        chamadas.push({ url, init });
        return {
          status: 200,
          ok: true,
          json: async () => ({ ok: true, itens: [{ produto_id: 1, quantidade: 1 }], contato: {}, cupom: null }),
        };
      },
    });
    assert.equal(dados.itens.length, 1);
    // Falha também não registra o token.
    await buscarRecuperacao(TOKEN, {
      env: ENV,
      fetchImpl: async () => {
        throw new Error(`falha com ${TOKEN}`);
      },
    });
  } finally {
    Object.assign(console, originais);
  }
  assert.equal(chamadas[0].url, "https://painel.exemplo.com/api/webhooks/site/recuperar");
  assert.equal(chamadas[0].init.method, "POST");
  assert.equal(chamadas[0].init.headers["X-Site-Webhook-Key"], "chave-secreta");
  assert.deepEqual(JSON.parse(chamadas[0].init.body), { token: TOKEN });
  assert.ok(!chamadas[0].url.includes(TOKEN));
  assert.equal(registros.some((linha) => linha.includes(TOKEN)), false);
});

// ---------- junção do carrinho ----------
const atual = (key, id, quantity) => ({ key, id, quantity });
const item = (id, quantidade, extra = {}) => ({ id, quantidade, ...extra });

test("planejar: carrinho vazio adiciona tudo; item igual ou maior no carrinho não muda; menor sobe", () => {
  assert.deepEqual(
    planejarRecuperacao([], [item(1, 2), item(2, 1)]).map((passo) => passo.tipo),
    ["adicionar", "adicionar"],
  );
  const passos = planejarRecuperacao(
    [atual("a", 1, 5), atual("b", 2, 1)],
    [item(1, 3), item(2, 4), item(3, 1)],
  );
  assert.deepEqual(
    passos.map((passo) => [passo.tipo, passo.item.id]),
    [["aumentar", 2], ["adicionar", 3]],
  );
  assert.equal(passos[0].para, 4);
});

test("planejar: item repetido no recuperado vira um só, com a maior quantidade", () => {
  const passos = planejarRecuperacao([], [item(1, 2), item(1, 7), item(1, 3)]);
  assert.equal(passos.length, 1);
  assert.equal(passos[0].item.quantidade, 7);
});

// Carrinho de mentira: guarda os itens e aceita/recusa conforme o "estoque".
function criarLoja({ itensIniciais = [], estoque = {}, cupomValido = true } = {}) {
  const itens = itensIniciais.map((i) => ({ ...i, maxQuantity: estoque[i.id] ?? 999, minQuantity: 1 }));
  const chamadas = { adicionar: [], atualizar: [], cupom: [] };
  const montar = (token = "novo-token") => ({
    cart: { items: itens.map((i) => ({ ...i })), coupons: [] },
    cartToken: token,
  });
  const limite = (id) => estoque[id] ?? 999;
  return {
    chamadas,
    itens,
    deps: {
      async getCart(token) {
        return montar(token ?? "novo-token");
      },
      async addItem(input, token) {
        chamadas.adicionar.push(input);
        if (input.quantity > limite(input.productId)) throw new Error("sem estoque");
        itens.push({
          key: `k${input.productId}`,
          id: input.productId,
          quantity: input.quantity,
          minQuantity: 1,
          maxQuantity: limite(input.productId),
        });
        return montar(token);
      },
      async updateItem(key, quantity, token) {
        chamadas.atualizar.push([key, quantity]);
        const alvo = itens.find((i) => i.key === key);
        if (!alvo || quantity > limite(alvo.id)) throw new Error("sem estoque");
        alvo.quantity = quantity;
        return montar(token);
      },
      async applyCoupon(code, token) {
        chamadas.cupom.push(code);
        if (!cupomValido) throw new Error("cupom inválido");
        return montar(token);
      },
    },
  };
}
const dadosDe = (itens, cupom = null) => ({ contato: {}, itens, cupom });

test("carrinho vazio é recriado com os itens em estoque", async () => {
  const loja = criarLoja();
  const r = await recriarCarrinho(dadosDe([item(1, 2), item(2, 1)]), undefined, loja.deps);
  assert.deepEqual(r.cart.items.map((i) => [i.id, i.quantity]), [[1, 2], [2, 1]]);
  assert.equal(r.restaurados, 2);
  assert.equal(r.ausentes, 0);
  assert.equal(r.ajustados, 0);
  assert.equal(r.cartToken, "novo-token");
});

test("item sem estoque fica de fora e é contado como ausente", async () => {
  const loja = criarLoja({ estoque: { 2: 0 } });
  const r = await recriarCarrinho(dadosDe([item(1, 2), item(2, 1)]), undefined, loja.deps);
  assert.deepEqual(r.cart.items.map((i) => i.id), [1]);
  assert.equal(r.ausentes, 1);
  assert.equal(r.restaurados, 1);
});

test("estoque menor que o pedido: entra com o que há e avisa o ajuste", async () => {
  const loja = criarLoja({ estoque: { 1: 4 } });
  const r = await recriarCarrinho(dadosDe([item(1, 10)]), undefined, loja.deps);
  assert.equal(r.cart.items[0].quantity, 4);
  assert.equal(r.ajustados, 1);
  assert.equal(r.ausentes, 0);
});

test("carrinho com itens: junta sem duplicar e fica com a MAIOR quantidade", async () => {
  const loja = criarLoja({ itensIniciais: [
    { key: "k1", id: 1, quantity: 5 },
    { key: "k2", id: 2, quantity: 1 },
  ] });
  const r = await recriarCarrinho(
    dadosDe([item(1, 3), item(2, 4), item(3, 2)]),
    "token-da-pessoa",
    loja.deps,
  );
  const porId = Object.fromEntries(r.cart.items.map((i) => [i.id, i.quantity]));
  assert.deepEqual(porId, { 1: 5, 2: 4, 3: 2 });
  assert.equal(r.cart.items.length, 3);
  assert.equal(r.cartToken, "token-da-pessoa");
  assert.equal(r.restaurados, 2);
  // O item que já tinha mais (id 1) nem foi tocado.
  assert.ok(!loja.chamadas.atualizar.some(([key]) => key === "k1"));
});

test("variação é recriada com os atributos; cupom é aplicado e cupom ruim é ignorado", async () => {
  const loja = criarLoja();
  await recriarCarrinho(
    dadosDe([item(5120, 1, { variacao: [{ attribute: "Cor", value: "Branco" }] })], "VOLTA10"),
    undefined,
    loja.deps,
  );
  assert.deepEqual(loja.chamadas.adicionar[0].variation, [{ attribute: "Cor", value: "Branco" }]);
  assert.deepEqual(loja.chamadas.cupom, ["VOLTA10"]);

  const ruim = criarLoja({ cupomValido: false });
  const r = await recriarCarrinho(dadosDe([item(1, 1)], "VENCIDO"), undefined, ruim.deps);
  assert.equal(r.cart.items.length, 1);
});

test("tudo sem estoque deixa o carrinho vazio (a rota manda para o carrinho com aviso)", async () => {
  const loja = criarLoja({ estoque: { 1: 0, 2: 0 } });
  const r = await recriarCarrinho(dadosDe([item(1, 1), item(2, 1)]), undefined, loja.deps);
  assert.equal(r.cart.items.length, 0);
  assert.equal(r.ausentes, 2);
});

// ---------- cookie de pré-preenchimento ----------
test("cookie: ida e volta passa pelo mesmo crivo do link pré-preenchido", () => {
  const bruto = serializarRecuperacao({
    contato: { nome: "Maria Souza", telefone: "5511987654321", cep: "13201000" },
    aviso: { restaurados: 2, ausentes: 1, ajustados: 0 },
  });
  const lido = lerRecuperacao(bruto);
  assert.equal(lido.prefill.firstName, "Maria");
  assert.equal(lido.prefill.lastName, "Souza");
  assert.equal(lido.prefill.phone, "(11) 98765-4321");
  assert.equal(lido.prefill.postalCode, "13201-000");
  assert.deepEqual(lido.aviso, { restaurados: 2, ausentes: 1, ajustados: 0 });
});

test("cookie: nome sem HTML, CEP e WhatsApp inválidos são descartados, lixo vira null", () => {
  const sujo = lerRecuperacao(
    JSON.stringify({ v: 1, nome: "<b>Ana</b>", whatsapp: "123", cep: "1234", r: 1 }),
  );
  assert.equal(sujo.prefill.firstName, "Ana");
  assert.ok(!JSON.stringify(sujo.prefill).includes("<"));
  assert.equal(sujo.prefill.phone, undefined);
  assert.equal(sujo.prefill.postalCode, undefined);
  assert.equal(lerRecuperacao(undefined), null);
  assert.equal(lerRecuperacao("não é json"), null);
  assert.equal(lerRecuperacao(JSON.stringify({ v: 2 })), null);
  const vazio = lerRecuperacao(JSON.stringify({ v: 1 }));
  assert.equal(vazio.prefill, null);
  assert.deepEqual(vazio.aviso, { restaurados: 0, ausentes: 0, ajustados: 0 });
});

// ---------- a rota e o checkout ----------
test("rota /r/[token]: flag, robô, token e resposta única, sem dado pessoal na URL nem token no log", () => {
  const route = read("app/r/[token]/route.ts");
  // Ordem: flag desligada → robô → limite → formato → CRM → carrinho.
  const ordem = [
    "recuperacaoLigada()",
    "ehRoboDeLink(",
    "rateLimiter.isLimited(",
    "tokenDeRecuperacaoValido(token)",
    "await buscarRecuperacao(token)",
    "await recriarCarrinho(",
  ].map((trecho) => route.indexOf(trecho));
  assert.ok(ordem.every((posicao) => posicao > -1), "faltou um passo na rota");
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem);
  // Token inválido e CRM sem resposta: o mesmo redirecionamento.
  assert.equal(route.split("redirecionar(AVISO_EXPIRADO)").length - 1, 3);
  assert.ok(route.includes('"/carrinho?aviso=link-expirado"'));
  // Sem flag: direto para o carrinho.
  assert.match(route, /if \(!recuperacaoLigada\(\)\) return redirecionar\("\/carrinho"\)/);
  // Segurança.
  assert.ok(route.includes('"Referrer-Policy", "no-referrer"'));
  assert.ok(route.includes("httpOnly: true"));
  assert.ok(route.includes("maxAge: COOKIE_RECUPERACAO_SEGUNDOS"));
  assert.ok(!route.includes("console."));
  // O redirecionamento para o checkout não leva dado nenhum na URL.
  assert.ok(route.includes('redirecionar("/checkout")'));
  assert.ok(!/\/checkout\?/.test(route));
  // Robô: página simples; o texto pedido.
  assert.ok(route.includes("Continuar minha compra na Persi"));
});

test("o cookie é entregue pelo servidor, o pré-preenchimento vale uma vez e o cookie é apagado", () => {
  const page = read("app/checkout/page.tsx");
  assert.ok(page.includes("lerRecuperacao((await cookies()).get(COOKIE_RECUPERACAO)?.value)"));
  assert.ok(page.includes("<CheckoutRecoveryNotice recuperacao={recuperacao} />"));

  const notice = read("components/Checkout/CheckoutRecoveryNotice.tsx");
  assert.ok(notice.includes("storeCheckoutPrefill(prefill)"));
  assert.ok(notice.includes('method: "DELETE"'));
  assert.ok(notice.includes("/api/checkout/recuperacao"));
  assert.ok(notice.includes("Recuperamos os itens do seu carrinho."));
  assert.ok(notice.includes("Alguns itens não estão mais disponíveis."));

  const apagar = read("app/api/checkout/recuperacao/route.ts");
  assert.ok(apagar.includes("export async function DELETE"));
  assert.ok(apagar.includes("maxAge: 0"));
  assert.ok(apagar.includes("expires: new Date(0)"));
  assert.ok(apagar.includes("httpOnly: true"));

  // Fase A: o pré-preenchimento da sessão é aplicado uma vez e apagado.
  const form = read("components/Checkout/CheckoutForm.tsx");
  assert.ok(form.includes("clearStoredCheckoutPrefill()"));
  assert.ok(form.includes("readStoredCheckoutPrefill()"));
});

test("aviso no carrinho quando o link não vale, sem motivo técnico", () => {
  const aviso = read("components/Cart/CartRecoveryNotice.tsx");
  assert.ok(aviso.includes("Esse link expirou, mas seus produtos continuam na loja."));
  const page = read("app/carrinho/page.tsx");
  assert.ok(page.includes("<CartRecoveryNotice />"));
  assert.ok(page.includes("<Suspense"));
  const mensagens = aviso.slice(aviso.indexOf("const MENSAGENS"), aviso.indexOf("};", aviso.indexOf("const MENSAGENS")));
  for (const tecnico of ["token", "CRM", "410", "404", "painel", "erro"]) {
    assert.ok(!mensagens.toLowerCase().includes(tecnico.toLowerCase()), `não mostrar: ${tecnico}`);
  }
});
