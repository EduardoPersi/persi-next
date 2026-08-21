const baseUrl = process.env.CHECKOUT_STAGING_BASE_URL?.replace(/\/+$/, "");
const cookie = process.env.CHECKOUT_STAGING_COOKIE;
const secret = process.env.CHECKOUT_STAGING_DRY_RUN_SECRET;
const bodyJson = process.env.CHECKOUT_STAGING_PAYMENT_JSON;

if (!baseUrl || !cookie || !secret || !bodyJson) {
  console.error("Configure CHECKOUT_STAGING_BASE_URL, CHECKOUT_STAGING_COOKIE, CHECKOUT_STAGING_DRY_RUN_SECRET e CHECKOUT_STAGING_PAYMENT_JSON.");
  process.exit(1);
}

const body = JSON.parse(bodyJson);
const startedAt = performance.now();
const responses = await Promise.all(
  Array.from({ length: 20 }, async (_, index) => {
    const response = await fetch(`${baseUrl}/api/checkout/payment`, {
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
    return { status: response.status, code: result?.code, orderId: result?.orderId };
  }),
);

const created = responses.filter(({ code }) => code === "STAGING_STOPPED_BEFORE_GATEWAY");
const orderIds = [...new Set(created.map(({ orderId }) => orderId).filter(Boolean))];
console.log({ durationMs: Math.round(performance.now() - startedAt), statuses: responses.map(({ status }) => status), orderIds });
if (created.length !== 1 || orderIds.length !== 1) {
  console.error("Falha: a disputa não produziu exatamente um vencedor/pedido.");
  process.exit(1);
}
console.log("PASS: 20 chamadas, um vencedor e um único order_id; confirme também no WooCommerce.");
