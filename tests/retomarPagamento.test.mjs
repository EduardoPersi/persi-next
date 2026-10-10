import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildAttemptResponseBody, resolveAttemptAccess } from "../lib/commerce/attemptResponse.ts";
import { pollPaymentAttempt } from "../lib/commerce/paymentPolling.ts";
import { rememberPendingPayment } from "../lib/commerce/pendingPayment.ts";
import { resumePendingPayment } from "../lib/commerce/resumePendingPayment.ts";
import {
  ATTEMPT_KEY_AUTHORIZATION_WINDOW_MS,
  isAuthorizedByAttemptKey,
  isAuthorizedForOrderStatus,
} from "../services/payments/statusAuthorization.ts";

const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const AGORA = Date.parse("2026-10-09T15:00:00Z");
const CHAVE = "6f1c1c1e-5a0b-4d1e-9a0b-5a0b4d1e9a0b";
const minutosAtras = (n) => new Date(AGORA - n * 60_000).toISOString();

function pedido(overrides = {}) {
  return {
    id: 1701,
    status: "processing",
    total: "199.90",
    currency: "BRL",
    paymentMethod: "mercadopago_card",
    billingEmail: "maria@example.com",
    billingName: "Maria",
    billingPhone: "11987654321",
    metaData: { _persi_idempotency_key: CHAVE, _persi_checkout_owner_token: "token-novo" },
    createdAtGmt: minutosAtras(2),
    ...overrides,
  };
}

test("F5 no meio do pagamento: o cookie ficou com o token antigo, mas a chave da tentativa autoriza", () => {
  const order = pedido();
  // O cookie antigo não bate com o token que ficou no pedido: a prova do cookie falha...
  assert.equal(isAuthorizedForOrderStatus(order, "token-antigo", undefined), false);
  // ...e a posse da chave (pedido com menos de 30 min) vale como segunda prova.
  assert.equal(isAuthorizedByAttemptKey(order, CHAVE, AGORA), true);
});

test("a chave só autoriza se for a do pedido, dentro de 30 minutos e com data conhecida", () => {
  assert.equal(ATTEMPT_KEY_AUTHORIZATION_WINDOW_MS, 30 * 60_000);
  assert.equal(isAuthorizedByAttemptKey(pedido(), "6f1c1c1e-5a0b-4d1e-9a0b-000000000000", AGORA), false);
  assert.equal(isAuthorizedByAttemptKey(pedido(), "", AGORA), false);
  assert.equal(isAuthorizedByAttemptKey(pedido({ metaData: {} }), CHAVE, AGORA), false);
  assert.equal(isAuthorizedByAttemptKey(pedido({ createdAtGmt: minutosAtras(29) }), CHAVE, AGORA), true);
  assert.equal(isAuthorizedByAttemptKey(pedido({ createdAtGmt: minutosAtras(30) }), CHAVE, AGORA), false);
  assert.equal(isAuthorizedByAttemptKey(pedido({ createdAtGmt: undefined }), CHAVE, AGORA), false);
  assert.equal(isAuthorizedByAttemptKey(pedido({ createdAtGmt: new Date(AGORA + 120_000).toISOString() }), CHAVE, AGORA), false);
});

test("rota de tentativa: usa a decisão pura, nunca grava cookie nem lê o token do dono, e continua só de leitura", () => {
  const rota = read("app/api/checkout/payment/attempt/route.ts");
  assert.ok(rota.includes("resolveAttemptAccess({"));
  assert.ok(rota.includes('if (access === "none") return processing();'));
  assert.ok(rota.includes("buildAttemptResponseBody({ outcome, access, key, orderId: order.id })"));
  assert.ok(!rota.includes("cookies.set"));
  assert.ok(!rota.includes("getCheckoutOwnerToken"));
  assert.ok(!rota.includes("getCartTokenCookieOptions"));
  assert.ok(!/set-cookie/i.test(rota));
  const semComentarios = rota.replace(/^\s*\/\/.*$/gm, "");
  for (const proibido of ["createCardCharge", "reconcilePaymentReference", "markOrderAs", "transitionCheckoutAttempt"]) {
    assert.ok(!semComentarios.includes(proibido), proibido);
  }
  // O módulo da decisão também não tem cookie nem token do dono.
  const decisao = read("lib/commerce/attemptResponse.ts").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
  assert.ok(!/cookie|getCheckoutOwnerToken|ownerToken/i.test(decisao));
});

// ---------- a decisão da rota (comportamento) ----------
test("cookie certo → página completa; conta do pedido → página completa", () => {
  const comCookie = resolveAttemptAccess({ order: pedido(), cartToken: "token-novo", sessionEmail: undefined, key: "", nowMs: AGORA });
  assert.equal(comCookie, "full");
  const logado = resolveAttemptAccess({ order: pedido(), cartToken: "token-antigo", sessionEmail: "MARIA@example.com", key: "", nowMs: AGORA });
  assert.equal(logado, "full");
  assert.deepEqual(buildAttemptResponseBody({ outcome: "created", access: "full", key: CHAVE, orderId: 1701 }), {
    outcome: "created",
    confirmationUrl: `/checkout/confirmacao?attempt=${CHAVE}`,
  });
});

test("só a chave certa (pedido novo) → confirmação simples: número do pedido, sem link, sem token, sem dado pessoal", () => {
  const acesso = resolveAttemptAccess({ order: pedido(), cartToken: "token-antigo", sessionEmail: undefined, key: CHAVE, nowMs: AGORA });
  assert.equal(acesso, "key");
  const corpo = buildAttemptResponseBody({ outcome: "created", access: acesso, key: CHAVE, orderId: 1701 });
  assert.deepEqual(corpo, { outcome: "created", orderNumber: 1701 });
  const texto = JSON.stringify(corpo);
  for (const proibido of ["maria", "Maria", "987654321", "199.90", "token", "confirmacao", CHAVE]) {
    assert.ok(!texto.includes(proibido), `vazou: ${proibido}`);
  }
  // Sem cookie: o corpo não tem nenhum campo de token.
  assert.deepEqual(Object.keys(corpo).sort(), ["orderNumber", "outcome"]);
});

test("chave errada, ausente ou pedido com 30 min ou mais → 'processando', sem número de pedido", () => {
  const casos = [
    pedido({ createdAtGmt: minutosAtras(31) }),
    pedido({ createdAtGmt: minutosAtras(30) }),
  ];
  for (const order of casos) {
    const acesso = resolveAttemptAccess({ order, cartToken: "token-antigo", sessionEmail: undefined, key: CHAVE, nowMs: AGORA });
    assert.equal(acesso, "none");
    assert.deepEqual(buildAttemptResponseBody({ outcome: "created", access: acesso, key: CHAVE, orderId: 1701 }), { outcome: "processing" });
  }
  for (const key of ["6f1c1c1e-5a0b-4d1e-9a0b-000000000000", ""]) {
    const acesso = resolveAttemptAccess({ order: pedido(), cartToken: "token-antigo", sessionEmail: undefined, key, nowMs: AGORA });
    assert.equal(acesso, "none");
    assert.deepEqual(buildAttemptResponseBody({ outcome: "created", access: acesso, key: CHAVE, orderId: 1701 }), { outcome: "processing" });
  }
  // Sem cookie nem sessão e sem chave: nada.
  assert.equal(resolveAttemptAccess({ order: pedido(), cartToken: undefined, sessionEmail: undefined, key: "", nowMs: AGORA }), "none");
});

test("recusado e processando seguem iguais, qualquer que seja a prova (a chave nova nasce no navegador)", () => {
  for (const access of ["full", "key"]) {
    assert.deepEqual(buildAttemptResponseBody({ outcome: "declined", access, key: CHAVE, orderId: 1701 }), { outcome: "declined" });
    assert.deepEqual(buildAttemptResponseBody({ outcome: "processing", access, key: CHAVE, orderId: 1701 }), { outcome: "processing" });
  }
});

test("a página do pedido e a rota de status NÃO aceitam a chave como prova (não mostram dado do pedido por ela)", () => {
  for (const arquivo of ["app/checkout/confirmacao/page.tsx", "app/api/checkout/payment/status/route.ts"]) {
    assert.ok(!read(arquivo).includes("isAuthorizedByAttemptKey"), arquivo);
  }
});

// ---------- o que o navegador faz com a resposta ----------
test("polling: created com link → página completa; created só com número → confirmação simples; pedido inválido segue esperando", async () => {
  const esperas = [];
  const base = { wait: async (ms) => esperas.push(ms), intervalMs: 5, timeoutMs: 1000 };
  const completa = await pollPaymentAttempt({ ...base, check: async () => ({ outcome: "created", confirmationUrl: "/checkout/confirmacao?attempt=x" }) });
  assert.deepEqual(completa, { kind: "created", confirmationUrl: "/checkout/confirmacao?attempt=x" });
  const simples = await pollPaymentAttempt({ ...base, check: async () => ({ outcome: "created", orderNumber: 1701 }) });
  assert.deepEqual(simples, { kind: "created_simple", orderNumber: 1701 });
  // Número inválido ou ausente não conta: segue esperando até o tempo acabar.
  let t = 0;
  for (const invalido of [{ outcome: "created" }, { outcome: "created", orderNumber: 0 }, { outcome: "created", orderNumber: 1.5 }, { outcome: "created", orderNumber: "17" }]) {
    t = 0;
    const r = await pollPaymentAttempt({ ...base, now: () => (t += 400), check: async () => invalido });
    assert.deepEqual(r, { kind: "timeout" });
  }
  // Recusado e processando seguem iguais.
  assert.deepEqual(await pollPaymentAttempt({ ...base, check: async () => ({ outcome: "declined" }) }), { kind: "declined" });
  t = 0;
  assert.deepEqual(await pollPaymentAttempt({ ...base, now: () => (t += 400), check: async () => ({ outcome: "processing" }) }), { kind: "timeout" });
});

test("retomada: created_simple limpa a chave pendente e devolve o número do pedido", async () => {
  const guardado = new Map();
  const storage = { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, v), removeItem: (k) => guardado.delete(k) };
  const agora = Date.now();
  rememberPendingPayment(storage, CHAVE, "mercadopago_card");
  const r = await resumePendingPayment({
    storage,
    check: async () => ({ outcome: "created", orderNumber: 1701 }),
    wait: async () => {},
    generateKey: () => "nova",
    now: () => agora,
  });
  assert.deepEqual(r, { kind: "created_simple", orderNumber: 1701 });
  assert.equal(guardado.size, 0);
});

test("recusado após o F5 segue o fluxo da recusa (chave nova)", async () => {
  const guardado = new Map();
  const storage = { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, v), removeItem: (k) => guardado.delete(k) };
  const agora = Date.now();
  rememberPendingPayment(storage, CHAVE, "mercadopago_card");
  const r = await resumePendingPayment({
    storage,
    check: async () => ({ outcome: "declined" }),
    wait: async () => {},
    generateKey: () => "6f1c1c1e-5a0b-4d1e-9a0b-aaaaaaaaaaaa",
    now: () => agora,
  });
  assert.equal(r.kind, "declined");
  assert.notEqual(r.newKey, CHAVE);
});

// ---------- a confirmação simples ----------
test("confirmação simples: só número do pedido, mensagem combinada e os dois botões, sem dado pessoal", () => {
  const aviso = read("components/Checkout/PaymentConfirmedNotice.tsx");
  assert.ok(aviso.includes("Pagamento confirmado! Pedido nº {orderNumber}. Os detalhes foram enviados para o seu e-mail."));
  assert.ok(aviso.includes("Continuar comprando"));
  assert.ok(aviso.includes("Falar no WhatsApp"));
  assert.ok(aviso.includes('href="/"'));
  // A única prop é o número do pedido.
  assert.ok(aviso.includes("orderNumber: number;"));
  assert.ok(!/email|phone|telefone|billing|address|endere|nome|items(?!-)|itens/i.test(aviso.replace(/^\s*\/\/.*$/gm, "")));
  const form = read("components/Checkout/CheckoutForm.tsx");
  assert.ok(form.includes("<PaymentConfirmedNotice orderNumber={confirmedOrderNumber} />"));
  // Mostra o número vindo da rota, não busca dado do pedido no navegador.
  assert.ok(form.includes("showSimpleConfirmation(resumed.orderNumber)"));
  assert.ok(form.includes("showSimpleConfirmation(polled.orderNumber)"));
});
