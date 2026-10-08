import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OPTIN_WHATSAPP_META,
  SESSAO_META,
  optinParaMeta,
  optinWhatsappDoPedido,
  sessaoDoPedido,
} from "../lib/painel/optin.ts";
import { avisarPeloWhatsapp } from "../lib/painel/whatsapp.ts";
import { enviarCobranca, montarAvisoDeCobranca } from "../lib/painel/cobranca.ts";
import { avisarAndamento, montarAvisoDeAndamento } from "../lib/painel/andamento.ts";
import { montarAvisoDoPedido } from "../lib/painel/pedido.ts";
import { sessaoDoCarrinho } from "../lib/painel/carrinho.ts";
import { createPendingOrder } from "../services/woocommerce/orders.ts";
import { paymentInitiationSchema } from "../lib/validation/payments.ts";

const read = (path) => readFileSync(path, "utf8");

const SESSAO = sessaoDoCarrinho("token-do-carrinho");
const COM_OPTIN = { [OPTIN_WHATSAPP_META]: "1", [SESSAO_META]: SESSAO };
const SEM_OPTIN = { [OPTIN_WHATSAPP_META]: "0", [SESSAO_META]: SESSAO };

// ---------- o metadado ----------
test("pedido antigo, sem o metadado, conta como marcado; só '0' é recusa", () => {
  assert.equal(optinWhatsappDoPedido(undefined), true);
  assert.equal(optinWhatsappDoPedido({}), true);
  assert.equal(optinWhatsappDoPedido({ [OPTIN_WHATSAPP_META]: "1" }), true);
  assert.equal(optinWhatsappDoPedido({ [OPTIN_WHATSAPP_META]: "0" }), false);
  assert.equal(optinParaMeta(true), "1");
  assert.equal(optinParaMeta(false), "0");
  assert.equal(sessaoDoPedido({ [SESSAO_META]: SESSAO }), SESSAO);
  assert.equal(sessaoDoPedido({ [SESSAO_META]: "qualquer-coisa" }), undefined);
  assert.equal(sessaoDoPedido({}), undefined);
});

// ---------- cobrança e andamento ----------
const pedido = (meta) => ({ id: 4512, billingPhone: "11988887777", total: "199.90", paymentMethod: "inter_pix", metaData: { ...meta } });
const COBRANCA = { forma: "pix", codigo: "00020101021226...6304ABCD", valorCentavos: 19990, venceEm: new Date(Date.now() + 3600e3).toISOString() };

test("cobrança: opt-in falso marca o aviso e não sai; pedido antigo e marcado enviam como antes", async () => {
  assert.equal(montarAvisoDeCobranca(pedido(SEM_OPTIN), COBRANCA, "agora").optin_whatsapp, false);
  // Marcado ou antigo: o aviso é idêntico ao de antes (sem o campo novo).
  assert.equal("optin_whatsapp" in montarAvisoDeCobranca(pedido(COM_OPTIN), COBRANCA, "agora"), false);
  assert.equal("optin_whatsapp" in montarAvisoDeCobranca(pedido({}), COBRANCA, "agora"), false);

  const enviados = [];
  const enviar = async (aviso) => {
    enviados.push(aviso);
    return { enviado: true, conversa: 1 };
  };
  const marcados = [];
  const deps = { env: { PAINEL_ENVIAR_COBRANCA: "1" }, enviar, marcar: async (id, valor) => marcados.push([id, valor]) };

  const recusou = await enviarCobranca(pedido(SEM_OPTIN), COBRANCA, "agora", deps);
  assert.equal(recusou.enviado, false);
  assert.equal(recusou.podeTentarDeNovo, false);
  assert.equal(enviados.length, 0);
  assert.equal(marcados.length, 0);

  const antigo = await enviarCobranca(pedido({}), COBRANCA, "agora", deps);
  assert.equal(antigo.enviado, true);
  const marcado = await enviarCobranca(pedido(COM_OPTIN), { ...COBRANCA }, "agora", deps);
  assert.equal(marcado.enviado, true);
  assert.equal(enviados.length, 2);
});

test("andamento: opt-in falso não envia (nem o 'enviado' com rastreio); antigo e marcado enviam", async () => {
  assert.equal(montarAvisoDeAndamento(pedido(SEM_OPTIN), "cancelado").optin_whatsapp, false);
  assert.equal("optin_whatsapp" in montarAvisoDeAndamento(pedido(COM_OPTIN), "cancelado"), false);
  assert.equal("optin_whatsapp" in montarAvisoDeAndamento(pedido({}), "cancelado"), false);

  const enviados = [];
  const deps = {
    env: { PAINEL_AVISAR_ANDAMENTO: "1" },
    enviar: async (aviso) => {
      enviados.push(aviso);
      return { enviado: true, conversa: 1 };
    },
  };
  for (const evento of ["cancelado", "concluido", "reembolsado", "enviado"]) {
    const r = await avisarAndamento(pedido(SEM_OPTIN), evento, { rastreio: "BR123" }, deps);
    assert.equal(r.enviado, false);
  }
  assert.equal(enviados.length, 0);

  assert.equal((await avisarAndamento(pedido({}), "cancelado", {}, deps)).enviado, true);
  assert.equal((await avisarAndamento(pedido(COM_OPTIN), "enviado", { rastreio: "BR123" }, deps)).enviado, true);
  assert.equal(enviados.length, 2);
});

test("avisarPeloWhatsapp: a trava central não chama o painel para cobrança/andamento de quem desmarcou", async () => {
  const chamadas = [];
  const fetchOriginal = globalThis.fetch;
  const envOriginal = { url: process.env.PAINEL_URL, chave: process.env.SITE_WEBHOOK_KEY };
  process.env.PAINEL_URL = "https://painel.exemplo.com";
  process.env.SITE_WEBHOOK_KEY = "chave";
  globalThis.fetch = async (url, init) => {
    chamadas.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ conversa: 7 }) };
  };
  try {
    const base = { telefone: "11988887777", pedido: "4512" };
    const cobranca = { tipo: "cobranca", forma: "pix", momento: "agora", codigo: "x", valor_centavos: 100, vence_em: "2026-10-08T15:00:00Z", ...base };
    const andamento = { tipo: "andamento", evento: "cancelado", ...base };

    for (const aviso of [{ ...cobranca, optin_whatsapp: false }, { ...andamento, optin_whatsapp: false }]) {
      const r = await avisarPeloWhatsapp(aviso);
      assert.equal(r.enviado, false);
      assert.equal(r.podeTentarDeNovo, false);
    }
    assert.equal(chamadas.length, 0);

    // Sem a marca (pedido antigo ou marcado): sai, e o corpo não ganha campo novo.
    for (const aviso of [cobranca, andamento]) {
      const r = await avisarPeloWhatsapp(aviso);
      assert.equal(r.enviado, true);
    }
    assert.equal(chamadas.length, 2);
    for (const { init } of chamadas) assert.ok(!init.body.includes("optin_whatsapp"));
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [nome, valor] of [["PAINEL_URL", envOriginal.url], ["SITE_WEBHOOK_KEY", envOriginal.chave]]) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  }
});

// ---------- o pedido pago ----------
test("o evento 'pedido' leva sessao e optin_whatsapp (contrato, seção 6)", () => {
  const base = { id: 10482, billingPhone: "11987654321", billingEmail: "maria@example.com", total: "69.80" };
  const marcado = montarAvisoDoPedido({ ...base, metaData: { ...COM_OPTIN } }, "pago", {});
  assert.equal(marcado.pago, true);
  assert.equal(marcado.sessao, SESSAO);
  assert.equal(marcado.optin_whatsapp, true);

  const recusou = montarAvisoDoPedido({ ...base, metaData: { ...SEM_OPTIN } }, "pago", {});
  assert.equal(recusou.optin_whatsapp, false);
  assert.equal(recusou.sessao, SESSAO);
  // O pedido pago AINDA vai ao painel (ele encerra a recuperação); o painel só não escreve ao cliente.
  assert.equal(recusou.pago, true);

  // Pedido antigo: sem sessao, e conta como marcado.
  const antigo = montarAvisoDoPedido({ ...base, metaData: {} }, "pago", {});
  assert.equal("sessao" in antigo, false);
  assert.equal(antigo.optin_whatsapp, true);
});

// ---------- gravação no pedido: só metadado ----------
const endereco = {
  firstName: "Maria", lastName: "Silva", address1: "Rua do Rosário, 1", city: "Jundiaí",
  state: "SP", postcode: "13201000", country: "BR", email: "maria@example.com",
};
const entradaBase = {
  idempotencyKey: "key-1",
  items: [{ productId: 10, variationId: 0, quantity: 2 }, { productId: 20, variationId: 30, quantity: 1 }],
  billingAddress: endereco,
  shippingAddress: endereco,
  paymentMethod: "inter_pix",
  ownerToken: "cart-token-1",
  discountFee: { name: "Desconto Pix", amount: 12.5 },
  shippingLine: { name: "Frete Expresso", amount: 25, methodId: "flat_rate" },
  couponCodes: ["VOLTA10"],
};
async function corpoDoPedido(extra) {
  let corpo;
  await createPendingOrder({ ...entradaBase, ...extra }, async (_endpoint, body) => {
    corpo = body;
    return { id: 501, status: "pending", total: "199.90", currency: "BRL", billing: {}, meta_data: [] };
  });
  return corpo;
}

test("sessao e opt-in entram no pedido SÓ como metadado: valores, total, frete e cupom ficam idênticos", async () => {
  const sem = await corpoDoPedido({});
  const com = await corpoDoPedido({ sessao: SESSAO, whatsappOptIn: false });

  const meta = Object.fromEntries(com.meta_data.map((m) => [m.key, m.value]));
  assert.equal(meta[SESSAO_META], SESSAO);
  assert.equal(meta[OPTIN_WHATSAPP_META], "0");
  assert.equal(optinWhatsappDoPedido(meta), false);

  // Tudo o que não é metadado é exatamente igual.
  const { meta_data: metaSem, ...restoSem } = sem;
  const { meta_data: metaCom, ...restoCom } = com;
  assert.deepEqual(restoCom, restoSem);
  // E os metadados antigos continuam, na mesma ordem, com só dois a mais.
  assert.deepEqual(metaCom.slice(0, metaSem.length), metaSem);
  assert.equal(metaCom.length, metaSem.length + 2);
  // Os valores que definem a cobrança estão lá, intactos.
  assert.deepEqual(com.fee_lines, [{ name: "Desconto Pix", total: "-12.50" }]);
  assert.equal(com.shipping_lines[0].total, "25.00");
  assert.deepEqual(com.coupon_lines, [{ code: "VOLTA10" }]);
});

test("sem sessao nem opt-in, o pedido nasce exatamente como antes; marcado grava '1'", async () => {
  const sem = await corpoDoPedido({});
  assert.ok(!sem.meta_data.some((m) => m.key === SESSAO_META || m.key === OPTIN_WHATSAPP_META));
  const marcado = await corpoDoPedido({ whatsappOptIn: true });
  assert.equal(marcado.meta_data.find((m) => m.key === OPTIN_WHATSAPP_META).value, "1");
});

// ---------- a requisição de pagamento e o checkout ----------
test("o pagamento aceita a escolha de WhatsApp (opcional, booleana) sem afrouxar o resto", () => {
  const pix = {
    method: "inter_pix",
    idempotencyKey: "6f1c1c1e-5a0b-4d1e-9a0b-5a0b4d1e9a0b",
    document: "529.982.247-25",
    expectedAmount: 199.9,
  };
  assert.equal(paymentInitiationSchema.safeParse(pix).success, true);
  assert.equal(paymentInitiationSchema.safeParse({ ...pix, whatsappOptIn: false }).success, true);
  assert.equal(paymentInitiationSchema.safeParse({ ...pix, whatsappOptIn: "0" }).success, false);
  assert.equal(paymentInitiationSchema.safeParse({ ...pix, qualquerCoisa: 1 }).success, false);
  const schema = read("lib/validation/payments.ts");
  assert.equal(schema.split("whatsappOptIn: whatsappOptInSchema").length - 1, 5);
});

test("rota de pagamento: a sessao vem do token do navegador e só dois campos novos entram", () => {
  const route = read("app/api/checkout/payment/route.ts");
  assert.ok(route.includes("const sessaoDoPedido = activeCartToken ? sessaoDoCarrinho(activeCartToken) : undefined;"));
  // Calculada ANTES de o token poder ser trocado pelo WooCommerce.
  assert.ok(route.indexOf("sessaoDoCarrinho(activeCartToken)") < route.indexOf("activeCartToken = cartResult.cartToken"));
  assert.ok(route.includes("sessao: sessaoDoPedido,"));
  assert.ok(route.includes("whatsappOptIn: input.whatsappOptIn,"));
  // Nada de total, cobrança ou gateway nos trechos novos.
  const novo = route.slice(route.indexOf("const sessaoDoPedido"), route.indexOf("const startedAt"));
  assert.ok(!/total|amount|gateway|charge|provider/i.test(novo));

  const form = read("components/Checkout/CheckoutForm.tsx");
  assert.equal(form.split("whatsappOptIn: values.whatsappOptIn,").length - 1, 2);
});

test("e-mail e pedido pago seguem: o aviso de pago continua sendo enviado ao painel", () => {
  const whatsapp = read("lib/painel/whatsapp.ts");
  // A trava vale só para cobrança e andamento.
  assert.ok(whatsapp.includes('(aviso.tipo === "cobranca" || aviso.tipo === "andamento") && aviso.optin_whatsapp === false'));
  assert.ok(!whatsapp.includes('aviso.tipo === "pedido" && aviso.optin_whatsapp === false'));
  assert.ok(!whatsapp.includes("nodemailer"));
});
