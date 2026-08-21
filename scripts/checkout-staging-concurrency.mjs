const instanceUrls = (process.env.CHECKOUT_STAGING_INSTANCE_URLS || "")
  .split(",")
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const cookie = process.env.CHECKOUT_STAGING_COOKIE;
const secret = process.env.CHECKOUT_STAGING_DRY_RUN_SECRET;
const bodyJson = process.env.CHECKOUT_STAGING_PAYMENT_JSON;
const wordpressUrl = process.env.WORDPRESS_URL?.replace(/\/+$/, "");
const wooKey = process.env.WOOCOMMERCE_CONSUMER_KEY;
const wooSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET;

if (instanceUrls.length < 2 || !cookie || !secret || !bodyJson || !wordpressUrl || !wooKey || !wooSecret) {
  console.error("Configure duas CHECKOUT_STAGING_INSTANCE_URLS e as variáveis de cookie, dry-run, payload e WooCommerce.");
  process.exit(1);
}

const body = JSON.parse(bodyJson);
if (!body.idempotencyKey) throw new Error("CHECKOUT_STAGING_PAYMENT_JSON precisa conter idempotencyKey.");
const startedAt = performance.now();
const responses = await Promise.all(
  Array.from({ length: 20 }, async (_, index) => {
    const instanceUrl = instanceUrls[index % instanceUrls.length];
    const response = await fetch(`${instanceUrl}/api/checkout/payment`, {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie,
        "x-persi-staging-dry-run": secret,
        "x-persi-test-instance": index % 2 ? "instance-a" : "instance-b",
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    return { instance: index % instanceUrls.length, status: response.status, code: result?.code, orderId: result?.orderId };
  }),
);

const created = responses.filter(({ code }) => code === "STAGING_STOPPED_BEFORE_GATEWAY");
const orderIds = [...new Set(created.map(({ orderId }) => orderId).filter(Boolean))];
const ordersUrl = new URL("/wp-json/wc/v3/orders", wordpressUrl);
ordersUrl.searchParams.set("meta_key", "_persi_idempotency_key");
ordersUrl.searchParams.set("meta_value", body.idempotencyKey);
ordersUrl.searchParams.set("status", "any");
ordersUrl.searchParams.set("per_page", "100");
const wooResponse = await fetch(ordersUrl, {
  cache: "no-store",
  headers: { authorization: `Basic ${Buffer.from(`${wooKey}:${wooSecret}`).toString("base64")}` },
});
const wooOrders = await wooResponse.json().catch(() => null);
const realOrderIds = Array.isArray(wooOrders) ? wooOrders.map(({ id }) => id) : [];
console.log({ durationMs: Math.round(performance.now() - startedAt), responses, winnerOrderIds: orderIds, wooStatus: wooResponse.status, realOrderIds });
if (created.length !== 1 || orderIds.length !== 1 || !wooResponse.ok || realOrderIds.length !== 1 || realOrderIds[0] !== orderIds[0]) {
  console.error("Falha: a disputa não produziu exatamente um vencedor/pedido.");
  process.exit(1);
}
console.log("PASS: 20 chamadas em duas instâncias reais e exatamente um pedido confirmado no WooCommerce.");
