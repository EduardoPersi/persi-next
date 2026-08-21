const baseUrl = process.env.CHECKOUT_SMOKE_BASE_URL?.replace(/\/+$/, "");
const cookie = process.env.CHECKOUT_SMOKE_COOKIE;

if (!baseUrl || !cookie) {
  console.error("Configure CHECKOUT_SMOKE_BASE_URL e CHECKOUT_SMOKE_COOKIE.");
  process.exitCode = 1;
} else {
  const steps = [
    { name: "get-cart", path: "/api/cart", method: "GET" },
  ];

  const customerJson = process.env.CHECKOUT_SMOKE_CUSTOMER_JSON;
  if (customerJson) {
    steps.push({
      name: "update-customer-and-shipping",
      path: "/api/checkout/customer",
      method: "POST",
      body: customerJson,
    });
  }

  for (const step of steps) {
    const startedAt = performance.now();
    const response = await fetch(`${baseUrl}${step.path}`, {
      method: step.method,
      headers: {
        Cookie: cookie,
        Accept: "application/json",
        ...(step.body ? { "Content-Type": "application/json" } : {}),
      },
      body: step.body,
      cache: "no-store",
    });
    console.log({
      step: step.name,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      cacheControl: response.headers.get("cache-control"),
    });
  }
}
