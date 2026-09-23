import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMarkNativeCheckoutReady,
  handlePersistNativeCheckoutPii,
  handlePrepareNativeCheckout,
} from "../lib/commerce/nativeCheckoutPrepHandlers.ts";
import { clearIdempotencyCacheForTests } from "../lib/commerce/nativeCommerceIdempotency.ts";

const store = { storeId: "store-1", currency: "BRL" };
const guestOwner = { customerId: null, guestToken: "guest-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };

function baseCart(overrides = {}) {
  return {
    id: "cart-1", storeId: store.storeId, customerId: null, guestTokenFingerprint: "fp",
    currency: "BRL", status: "active", version: 3n,
    items: [{ id: "item-1", productVariantId: "v-1", quantity: 2n }],
    ...overrides,
  };
}

function basePrepareDeps(overrides = {}) {
  return {
    resolveSingleActiveStore: async () => store,
    resolveSingleActiveInventoryLocation: async () => "loc-1",
    readNativeCartById: async () => baseCart(),
    canAccessNativeCart: () => true,
    resolveStorePriceAuthority: async () => ({ priceListId: "pricelist-1", assignmentId: "a-1", assignmentVersion: 1n, currency: "BRL", commercialContext: "storefront_retail", validFrom: null, validTo: null }),
    prepareNativeCheckout: async () => ({ id: "checkout-1", status: "validating", version: 1n }),
    ...overrides,
  };
}

test.beforeEach(() => clearIdempotencyCacheForTests());

test("handlePrepareNativeCheckout falha fechado (422) para carrinho vazio, sem chamar prepareNativeCheckout", async () => {
  let prepareCalled = false;
  const result = await handlePrepareNativeCheckout(
    guestOwner,
    { cartId: "cart-1", idempotencyKey: "11111111-1111-1111-1111-111111111111", shippingRequired: false },
    basePrepareDeps({ readNativeCartById: async () => baseCart({ items: [] }), prepareNativeCheckout: async () => { prepareCalled = true; } }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(prepareCalled, false);
});

test("handlePrepareNativeCheckout falha fechado (404, não 403) quando o carrinho não pertence ao dono da requisição", async () => {
  const result = await handlePrepareNativeCheckout(
    guestOwner,
    { cartId: "cart-1", idempotencyKey: "22222222-2222-2222-2222-222222222222", shippingRequired: false },
    basePrepareDeps({ canAccessNativeCart: () => false }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "CART_NOT_FOUND");
});

// ---------- client-supplied price/shipping ignored (mandatory) ----------

test("handlePrepareNativeCheckout ignora qualquer priceListId/shipping vindo do input -- a autoridade é sempre resolveStorePriceAuthority", async () => {
  let capturedPriceListId;
  let capturedShippingRequired;
  const deps = basePrepareDeps({
    resolveStorePriceAuthority: async () => ({ priceListId: "authoritative-price-list", assignmentId: "a-1", assignmentVersion: 1n, currency: "BRL", commercialContext: "storefront_retail", validFrom: null, validTo: null }),
    prepareNativeCheckout: async (input) => {
      capturedPriceListId = input.priceListId;
      capturedShippingRequired = input.shippingRequired;
      return { id: "checkout-1", status: "validating", version: 1n };
    },
  });
  // The input type itself only allows shippingRequired: false (z.literal),
  // and carries no price/shipping-amount field at all -- this asserts the
  // handler never threads anything besides that literal through, and that
  // the price list actually used is the one resolveStorePriceAuthority
  // returned, not something reconstructable from client input.
  await handlePrepareNativeCheckout(
    guestOwner,
    { cartId: "cart-1", idempotencyKey: "33333333-3333-3333-3333-333333333333", shippingRequired: false },
    deps,
  );
  assert.equal(capturedPriceListId, "authoritative-price-list");
  assert.equal(capturedShippingRequired, false);
});

test("handlePrepareNativeCheckout: idempotencyKey repetida não chama prepareNativeCheckout duas vezes", async () => {
  let callCount = 0;
  const deps = basePrepareDeps({ prepareNativeCheckout: async () => { callCount += 1; return { id: "checkout-1", status: "validating", version: 1n }; } });
  const input = { cartId: "cart-1", idempotencyKey: "44444444-4444-4444-4444-444444444444", shippingRequired: false };
  await handlePrepareNativeCheckout(guestOwner, input, deps);
  await handlePrepareNativeCheckout(guestOwner, input, deps);
  assert.equal(callCount, 1);
});

test("handlePrepareNativeCheckout falha fechado (503) quando não há exatamente uma loja ativa", async () => {
  const result = await handlePrepareNativeCheckout(
    guestOwner,
    { cartId: "cart-1", idempotencyKey: "55555555-5555-5555-5555-555555555555", shippingRequired: false },
    basePrepareDeps({ resolveSingleActiveStore: async () => null }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test("handlePersistNativeCheckoutPii: chave repetida não chama persistNativeCheckoutPii duas vezes", async () => {
  let callCount = 0;
  const deps = { persistNativeCheckoutPii: async () => { callCount += 1; return { checkoutId: "checkout-1", checkoutVersion: 2n }; } };
  const input = { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "66666666-6666-6666-6666-666666666666", pii: { any: "shape" } };
  await handlePersistNativeCheckoutPii(guestOwner, input, deps);
  await handlePersistNativeCheckoutPii(guestOwner, input, deps);
  assert.equal(callCount, 1);
});

test("handlePersistNativeCheckoutPii falha fechado (422) sem customerId nem guestToken", async () => {
  const result = await handlePersistNativeCheckoutPii(
    { customerId: null, guestToken: null },
    { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "77777777-7777-7777-7777-777777777777", pii: {} },
    { persistNativeCheckoutPii: async () => { throw new Error("não deveria ser chamado"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
});

test("handleMarkNativeCheckoutReady retorna o checkoutId de entrada (já validado) em caso de sucesso", async () => {
  let captured;
  const result = await handleMarkNativeCheckoutReady(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "2", expectedPiiFingerprint: "a".repeat(64) },
    { markNativeCheckoutReady: async (input) => { captured = input; return { id: "checkout-1", status: "ready" }; } },
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.checkoutId, "checkout-1");
  assert.equal(captured.expectedVersion, 2n);
});

test("handleMarkNativeCheckoutReady mapeia CHECKOUT_PII_EXPIRED para 422", async () => {
  const result = await handleMarkNativeCheckoutReady(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "2", expectedPiiFingerprint: "a".repeat(64) },
    { markNativeCheckoutReady: async () => { throw new Error("CHECKOUT_PII_EXPIRED"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
});

// ---------- achados do smoke test de staging, 2026-09-23 ----------

test("handleMarkNativeCheckoutReady: ready sem PII persistida (CHECKOUT_PII_REQUIRED_OR_EXPIRED, o código real do SQL) responde 422, não 502", async () => {
  // mark_native_checkout_ready_r1d_legacy (supabase/migrations/20260905020000_...)
  // raises exactamente esta mensagem quando pii_ciphertext/pii_fingerprint
  // não batem -- faltava no mapeamento antes desta correção, e por isso a
  // chamada real em staging (sem POST pii antes) caía no default 502.
  const result = await handleMarkNativeCheckoutReady(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "2", expectedPiiFingerprint: "a".repeat(64) },
    { markNativeCheckoutReady: async () => { throw new Error("CHECKOUT_PII_REQUIRED_OR_EXPIRED"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(result.code, "CHECKOUT_PII_REQUIRED");
});

test("handleMarkNativeCheckoutReady: cookie adulterado (CHECKOUT_OWNER_DENIED) responde 404, não 403 nem 502", async () => {
  const result = await handleMarkNativeCheckoutReady(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "2", expectedPiiFingerprint: "a".repeat(64) },
    { markNativeCheckoutReady: async () => { throw new Error("CHECKOUT_OWNER_DENIED"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "CHECKOUT_NOT_FOUND");
});

test("handlePersistNativeCheckoutPii: cookie adulterado (CHECKOUT_OWNER_DENIED) responde 404, não 403 nem 502", async () => {
  const result = await handlePersistNativeCheckoutPii(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", pii: {} },
    { persistNativeCheckoutPii: async () => { throw new Error("checkout_owner_denied"); } }, // casing real varia entre migrations
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("handleMarkNativeCheckoutReady: um erro genuinamente desconhecido vira 502 e é logado como native_commerce_unexpected_error, sem PII", async (t) => {
  t.mock.method(console, "error", () => {});
  const dbError = new Error("Failed query: select * from mark_native_checkout_ready(...)");
  dbError.cause = Object.assign(new Error("deadlock detected"), { code: "40P01" });
  const result = await handleMarkNativeCheckoutReady(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "2", expectedPiiFingerprint: "a".repeat(64) },
    { markNativeCheckoutReady: async () => { throw dbError; } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(console.error.mock.calls.length, 1);
  const [eventName, fields] = console.error.mock.calls[0].arguments;
  assert.match(eventName, /native_commerce_unexpected_error/);
  assert.equal(fields.code, "40P01");
  assert.equal(fields.route, "POST /api/checkout/native/ready");
  const serialized = JSON.stringify(fields);
  assert.doesNotMatch(serialized, /deadlock detected/, "a mensagem crua do banco nunca deve ir para o log");
  for (const forbidden of [/email/i, /phone/i, /cpf/i, /cnpj/i, /endereco/i, /address/i, /\bname\b/i]) {
    assert.doesNotMatch(serialized, forbidden);
  }
});
