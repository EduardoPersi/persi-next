import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedForOrderStatus } from "../services/payments/statusAuthorization.ts";

function buildOrder({ ownerToken = "", billingEmail = "" } = {}) {
  return {
    id: 501,
    status: "pending",
    total: "199.90",
    currency: "BRL",
    paymentMethod: "inter_pix",
    billingEmail,
    metaData: ownerToken ? { _persi_checkout_owner_token: ownerToken } : {},
  };
}

test("autoriza convidado cujo Cart-Token bate com o token gravado na criação do pedido", () => {
  const order = buildOrder({ ownerToken: "cart-token-abc" });
  assert.equal(isAuthorizedForOrderStatus(order, "cart-token-abc", undefined), true);
});

test("autoriza cliente logado cujo e-mail de sessão bate com o billing do pedido", () => {
  const order = buildOrder({ billingEmail: "maria@example.com" });
  assert.equal(
    isAuthorizedForOrderStatus(order, undefined, "Maria@Example.com"),
    true,
  );
});

test("nega quando não há Cart-Token nem sessão", () => {
  const order = buildOrder({ ownerToken: "cart-token-abc", billingEmail: "maria@example.com" });
  assert.equal(isAuthorizedForOrderStatus(order, undefined, undefined), false);
});

test("nega Cart-Token de outro pedido (não bate com o gravado)", () => {
  const order = buildOrder({ ownerToken: "cart-token-abc" });
  assert.equal(isAuthorizedForOrderStatus(order, "cart-token-do-atacante", undefined), false);
});

test("nega e-mail de sessão que não bate com o billing do pedido", () => {
  const order = buildOrder({ billingEmail: "maria@example.com" });
  assert.equal(isAuthorizedForOrderStatus(order, undefined, "outra@example.com"), false);
});

test("nunca autoriza a partir de dois lados vazios (pedido sem token nem e-mail)", () => {
  const order = buildOrder();
  assert.equal(isAuthorizedForOrderStatus(order, "", ""), false);
  assert.equal(isAuthorizedForOrderStatus(order, undefined, undefined), false);
});
