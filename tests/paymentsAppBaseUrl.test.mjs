import assert from "node:assert/strict";
import test from "node:test";
import { buildWebhookUrl, getAppBaseUrl } from "../services/payments/appBaseUrl.ts";

test("getAppBaseUrl normaliza a origem sem barra final", () => {
  const env = { APP_BASE_URL: "https://app.persimateriais.com.br" };
  assert.equal(getAppBaseUrl(env), "https://app.persimateriais.com.br");
});

test("getAppBaseUrl rejeita ausência de configuração", () => {
  assert.throws(() => getAppBaseUrl({}), /APP_BASE_URL/);
});

test("getAppBaseUrl rejeita protocolo não https e path/query na origem", () => {
  assert.throws(() => getAppBaseUrl({ APP_BASE_URL: "http://app.persimateriais.com.br" }));
  assert.throws(() => getAppBaseUrl({ APP_BASE_URL: "https://app.persimateriais.com.br/foo" }));
});

test("buildWebhookUrl monta a URL final a partir do path do webhook", () => {
  const env = { APP_BASE_URL: "https://app.persimateriais.com.br" };
  assert.equal(
    buildWebhookUrl("/api/webhooks/inter", env),
    "https://app.persimateriais.com.br/api/webhooks/inter",
  );
  assert.equal(
    buildWebhookUrl("api/webhooks/pagbank", env),
    "https://app.persimateriais.com.br/api/webhooks/pagbank",
  );
});
