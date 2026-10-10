import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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

test("rota de tentativa: usa a chave só como segunda prova e reencaixa o cookie apenas quando o token falhou", () => {
  const rota = read("app/api/checkout/payment/attempt/route.ts");
  assert.ok(rota.includes("const authorizedByToken = isAuthorizedForOrderStatus("));
  assert.ok(rota.includes("if (!authorizedByToken && !isAuthorizedByAttemptKey(order, key, Date.now())) {"));
  // O cookie só é reencaixado quando o desfecho é "created" e a prova foi a chave.
  assert.ok(rota.includes('if (outcome === "created" && !authorizedByToken && ownerToken) {'));
  assert.ok(rota.includes("getCheckoutOwnerToken(order)"));
  // A rota continua só de leitura: nada de criar cobrança nem reconciliar pedido.
  const semComentarios = rota.replace(/^\s*\/\/.*$/gm, "");
  for (const proibido of ["createCardCharge", "reconcilePaymentReference", "markOrderAs", "transitionCheckoutAttempt"]) {
    assert.ok(!semComentarios.includes(proibido), proibido);
  }
});

test("a página do pedido e a rota de status NÃO aceitam a chave como prova (não mostram dado do pedido por ela)", () => {
  for (const arquivo of ["app/checkout/confirmacao/page.tsx", "app/api/checkout/payment/status/route.ts"]) {
    assert.ok(!read(arquivo).includes("isAuthorizedByAttemptKey"), arquivo);
  }
});
