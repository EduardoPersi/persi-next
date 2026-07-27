import assert from "node:assert/strict";

const baseUrl = process.env.CHECKOUT_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const productId = Number(process.env.CHECKOUT_TEST_PRODUCT_ID ?? "30772");
let cookie = "";

function assertPrivateNoStore(response) {
  const value = response.headers.get("cache-control") ?? "";
  assert.match(value, /\bprivate\b/);
  assert.match(value, /\bno-store\b/);
}

function captureCookie(response) {
  const setCookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("persi_cart_token="));
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  assert.ok(cookie, "A sessão deve manter persi_cart_token.");
}

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    cache: "no-store",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  });
  assertPrivateNoStore(response);
  captureCookie(response);
  const body = await response.json();
  return { response, body };
}

const initial = await request("/api/cart");
assert.equal(initial.response.status, 200);
assert.equal(initial.body.items.length, 0, "A sessão de teste deve iniciar vazia.");

const added = await request("/api/cart/items", {
  method: "POST",
  body: JSON.stringify({ productId, quantity: 1 }),
});
assert.equal(added.response.status, 200);
assert.equal(added.body.items.length, 1);
const itemKey = added.body.items[0].key;

try {
  const address = {
    firstName: "Teste",
    lastName: "Isolamento",
    company: "",
    address1: "Rua do Rosário, 1",
    address2: "Centro",
    city: "Jundiaí",
    state: "SP",
    postcode: "13201015",
    country: "BR",
  };
  const updated = await request("/api/checkout/customer", {
    method: "POST",
    body: JSON.stringify({
      billingAddress: {
        ...address,
        email: "checkout.test@example.com",
        phone: "11999999999",
      },
      shippingAddress: address,
    }),
  });
  assert.equal(updated.response.status, 200);
  assert.ok(updated.body.shippingPackages.length > 0);
  const firstPackage = updated.body.shippingPackages[0];
  assert.ok(firstPackage.rates.length > 0);

  const rate = firstPackage.rates[0];
  const selected = await request("/api/checkout/shipping", {
    method: "POST",
    body: JSON.stringify({
      packageId: firstPackage.packageId,
      rateId: rate.rateId,
    }),
  });
  assert.equal(selected.response.status, 200);
  assert.ok(
    selected.body.shippingPackages[0].rates.some(
      (candidate) => candidate.rateId === rate.rateId && candidate.selected,
    ),
  );
  assert.match(selected.body.totals.price.value, /^\d+$/);

  console.log(
    `Checkout aprovado: ${selected.body.shippingPackages.length} pacote(s), ` +
      `${selected.body.shippingPackages.reduce((sum, value) => sum + value.rates.length, 0)} taxa(s).`,
  );
} finally {
  const removed = await request("/api/cart/items", {
    method: "DELETE",
    body: JSON.stringify({ key: itemKey }),
  });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.body.items.length, 0);
}
