import assert from "node:assert/strict";
import test from "node:test";
import { isSameOriginRequest } from "../lib/commerce/nativeCommerceRequestGuards.ts";

const previousAppBaseUrl = process.env.APP_BASE_URL;
test.beforeEach(() => { process.env.APP_BASE_URL = "https://staging.persimateriais.com.br"; });
test.after(() => { if (previousAppBaseUrl === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = previousAppBaseUrl; });

function requestWith(headers) {
  return new Request("https://staging.persimateriais.com.br/api/cart/native", { method: "POST", headers });
}

// ---------- invalid Origin rejects (mandatory) ----------

test("isSameOriginRequest rejeita um Origin diferente do APP_BASE_URL", () => {
  assert.equal(isSameOriginRequest(requestWith({ origin: "https://evil.example.com" })), false);
});

test("isSameOriginRequest aceita um Origin igual ao APP_BASE_URL", () => {
  assert.equal(isSameOriginRequest(requestWith({ origin: "https://staging.persimateriais.com.br" })), true);
});

test("isSameOriginRequest falha fechado quando não há Origin nem Referer", () => {
  assert.equal(isSameOriginRequest(requestWith({})), false);
});

test("isSameOriginRequest usa Referer apenas quando Origin está ausente", () => {
  assert.equal(isSameOriginRequest(requestWith({ referer: "https://staging.persimateriais.com.br/carrinho" })), true);
  assert.equal(isSameOriginRequest(requestWith({ referer: "https://evil.example.com/carrinho" })), false);
});

test("isSameOriginRequest falha fechado com um Referer não parseável", () => {
  assert.equal(isSameOriginRequest(requestWith({ referer: "not-a-url" })), false);
});

test("isSameOriginRequest falha fechado quando APP_BASE_URL não está configurada", () => {
  delete process.env.APP_BASE_URL;
  assert.equal(isSameOriginRequest(requestWith({ origin: "https://staging.persimateriais.com.br" })), false);
});

test("isSameOriginRequest falha fechado quando APP_BASE_URL é inválida", () => {
  process.env.APP_BASE_URL = "not-a-url";
  assert.equal(isSameOriginRequest(requestWith({ origin: "https://staging.persimateriais.com.br" })), false);
});
