import assert from "node:assert/strict";

const wordpressUrl = process.env.WORDPRESS_URL;
const productId = Number(process.env.CHECKOUT_TEST_PRODUCT_ID ?? "30772");
assert.ok(wordpressUrl, "WORDPRESS_URL não configurada.");

const storeUrl = (path) =>
  new URL(`/wp-json/wc/store/v1/${path.replace(/^\/+/, "")}`, wordpressUrl);
let cartToken = "";

async function storeRequest(path, init = {}) {
  const response = await fetch(storeUrl(path), {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(cartToken ? { "Cart-Token": cartToken } : {}),
      ...init.headers,
    },
  });
  const renewedToken = response.headers.get("Cart-Token");
  if (renewedToken) cartToken = renewedToken;
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Store API respondeu ${response.status}: ${body.code ?? "erro"}`);
  }
  return body;
}

const initial = await storeRequest("cart");
assert.equal(initial.items.length, 0, "A sessão de auditoria deve iniciar vazia.");
const added = await storeRequest("cart/add-item", {
  method: "POST",
  body: JSON.stringify({ id: productId, quantity: 1 }),
});
const itemKey = added.items[0]?.key;
assert.ok(itemKey);

try {
  const address = {
    first_name: "Teste",
    last_name: "Auditoria",
    address_1: "Rua do Rosário, 1",
    address_2: "Centro",
    city: "Jundiaí",
    state: "SP",
    postcode: "13201015",
    country: "BR",
  };
  const cart = await storeRequest("cart/update-customer", {
    method: "POST",
    body: JSON.stringify({
      billing_address: {
        ...address,
        email: "checkout.test@example.com",
        phone: "11999999999",
      },
      shipping_address: address,
    }),
  });
  const paymentMethods = Array.isArray(cart.payment_methods)
    ? cart.payment_methods
    : [];
  console.log(
    JSON.stringify({
      paymentMethods,
      needsPayment: cart.needs_payment,
      needsShipping: cart.needs_shipping,
      shippingPackageCount: Array.isArray(cart.shipping_rates)
        ? cart.shipping_rates.length
        : 0,
    }),
  );
} finally {
  const cleaned = await storeRequest("cart/remove-item", {
    method: "POST",
    body: JSON.stringify({ key: itemKey }),
  });
  assert.equal(cleaned.items.length, 0);
}
