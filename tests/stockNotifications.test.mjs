import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STOCK_NOTIFICATION_ENDPOINT,
  getStockNotificationEndpoint,
  StockNotificationError,
  subscribeToBackInStockNotification,
} from "../services/woocommerce/stockNotifications.ts";

const subscription = {
  productId: 123,
  email: "cliente@example.test",
  consent: true,
  website: "",
  privacyPolicyVersion: "2026-07",
  privacyPolicyUrl:
    "https://persimateriais.com.br/politica-de-privacidade-e-seguranca",
};
const hmacConfig = {
  secret: "test-only-stock-secret",
  keyId: "primary",
  origin: "https://persimateriais.com.br",
};

test("aviso de estoque usa endpoint oficial quando variável está ausente", () => {
  assert.equal(getStockNotificationEndpoint({}), DEFAULT_STOCK_NOTIFICATION_ENDPOINT);
  assert.throws(
    () =>
      getStockNotificationEndpoint({
        WORDPRESS_STOCK_NOTIFICATION_ENDPOINT:
          "https://evil.example/wp-json/persi/v1/stock-notifications/subscribe",
      }),
    StockNotificationError,
  );
});

test("inscrição encaminha contrato ao plugin sem cache", async () => {
  let captured;
  const result = await subscribeToBackInStockNotification(subscription, {
    hmacConfig,
    fetchImplementation: async (url, init) => {
      captured = { url, init };
      return Response.json({ code: "accepted" }, { status: 202 });
    },
  });
  assert.deepEqual(result, { status: "success" });
  assert.equal(captured.url, DEFAULT_STOCK_NOTIFICATION_ENDPOINT);
  assert.deepEqual(JSON.parse(captured.init.body), subscription);
  assert.equal(captured.init.cache, "no-store");
});
