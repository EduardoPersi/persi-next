import assert from "node:assert/strict";

const baseUrl = process.env.CART_TEST_BASE_URL;

if (!baseUrl) {
  throw new Error(
    "Defina CART_TEST_BASE_URL com a URL pública da aplicação na Hostinger.",
  );
}

const cartUrl = new URL("/api/cart", baseUrl);
const itemsUrl = new URL("/api/cart/items", baseUrl);

function getCartCookie(response) {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("persi_cart_token="));

  assert.ok(cookie, "A resposta deve persistir persi_cart_token.");
  return cookie.split(";", 1)[0];
}

function assertPrivateNoStore(response) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  assert.match(cacheControl, /\bprivate\b/);
  assert.match(cacheControl, /\bno-store\b/);
}

const firstResponse = await fetch(cartUrl, { cache: "no-store" });
assert.equal(firstResponse.status, 200);
assertPrivateNoStore(firstResponse);
const firstCookie = getCartCookie(firstResponse);

const repeatedResponse = await fetch(cartUrl, {
  cache: "no-store",
  headers: { Cookie: firstCookie },
});
assert.equal(repeatedResponse.status, 200);
assertPrivateNoStore(repeatedResponse);
assert.equal(getCartCookie(repeatedResponse), firstCookie);

const secondSessionResponse = await fetch(cartUrl, { cache: "no-store" });
assert.equal(secondSessionResponse.status, 200);
assertPrivateNoStore(secondSessionResponse);
assert.notEqual(getCartCookie(secondSessionResponse), firstCookie);

const invalidMutationResponse = await fetch(itemsUrl, {
  method: "POST",
  cache: "no-store",
  headers: {
    "Content-Type": "application/json",
    Cookie: firstCookie,
  },
  body: JSON.stringify({}),
});
assert.equal(invalidMutationResponse.status, 400);
assertPrivateNoStore(invalidMutationResponse);
assert.equal(getCartCookie(invalidMutationResponse), firstCookie);

console.log(`Smoke test do carrinho aprovado em ${baseUrl}`);
