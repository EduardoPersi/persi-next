import assert from "node:assert/strict";
import test from "node:test";
import {
  handleAddNativeCartItem,
  handleCreateOrGetNativeCart,
  handleGetNativeCart,
  handleRemoveNativeCartItem,
  handleUpdateNativeCartItem,
} from "../lib/commerce/nativeCartHandlers.ts";
import { clearIdempotencyCacheForTests } from "../lib/commerce/nativeCommerceIdempotency.ts";

// Every DB/catalog seam here is injected via `deps` -- no Postgres
// connection, no import of anything under services/woocommerce (confirmed
// separately by tests/nativeCommerceStagingNoWooImports.test.mjs). Real
// end-to-end DB behavior for these same SQL functions is already proven by
// scripts/database/native-cart-*-concurrency.mjs.

const store = { storeId: "store-1", currency: "BRL" };
const guestOwner = { customerId: null, guestToken: "guest-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };

test.beforeEach(() => clearIdempotencyCacheForTests());

test("handleGetNativeCart retorna null quando não há carrinho ativo, sem criar nenhum", async () => {
  let findCalled = false;
  const result = await handleGetNativeCart(guestOwner, {
    resolveSingleActiveStore: async () => store,
    findActiveNativeCart: async () => {
      findCalled = true;
      return null;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data, null);
  assert.equal(findCalled, true);
});

test("handleGetNativeCart falha fechado (503) quando o contexto de loja é ambíguo", async () => {
  const result = await handleGetNativeCart(guestOwner, {
    resolveSingleActiveStore: async () => null,
    findActiveNativeCart: async () => { throw new Error("não deveria ser chamado"); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test("handleCreateOrGetNativeCart gera um guestToken novo e o retorna via setGuestToken quando não há cookie", async () => {
  let capturedGuestToken;
  const result = await handleCreateOrGetNativeCart(
    { customerId: null, guestToken: null },
    {
      resolveSingleActiveStore: async () => store,
      generateGuestCartToken: () => "generated-token",
      createNativeCart: async (input) => {
        capturedGuestToken = input.guestToken;
        return { id: "cart-1" };
      },
      readNativeCartById: async () => ({
        id: "cart-1", storeId: store.storeId, customerId: null, guestTokenFingerprint: "fp", currency: "BRL", status: "active", version: 1n, items: [],
      }),
    },
  );
  assert.equal(result.ok, true);
  assert.equal(capturedGuestToken, "generated-token");
  assert.equal(result.setGuestToken, "generated-token");
});

test("handleCreateOrGetNativeCart reafirma (não regenera) o guestToken existente do cookie, renovando sua validade", async () => {
  const result = await handleCreateOrGetNativeCart(guestOwner, {
    resolveSingleActiveStore: async () => store,
    generateGuestCartToken: () => { throw new Error("não deveria gerar um novo token quando um cookie já existe"); },
    createNativeCart: async () => ({ id: "cart-1" }),
    readNativeCartById: async () => ({
      id: "cart-1", storeId: store.storeId, customerId: null, guestTokenFingerprint: "fp", currency: "BRL", status: "active", version: 1n, items: [],
    }),
  });
  assert.equal(result.ok, true);
  // Same value as the incoming cookie, not a freshly generated one -- this
  // still resets the cookie's Max-Age on the response (a sliding 30-day
  // expiration), which is intentional, not a leftover default.
  assert.equal(result.setGuestToken, guestOwner.guestToken);
});

// ---------- unmapped product fails closed (mandatory) ----------

test("handleAddNativeCartItem falha fechado (404) para um produto Woo sem mapeamento nativo, sem tentar mutar o carrinho", async () => {
  let addCalled = false;
  const result = await handleAddNativeCartItem(
    "cart-1",
    guestOwner,
    { wooProductId: 999, quantity: 1, idempotencyKey: "11111111-1111-1111-1111-111111111111" },
    {
      resolveNativeVariantByWooProductId: async () => null,
      addNativeCartItem: async () => { addCalled = true; return { productVariantId: "v-1", quantity: 1n }; },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "PRODUCT_NOT_MAPPED");
  assert.equal(addCalled, false);
});

// ---------- idempotency-key replay (mandatory) ----------

test("handleAddNativeCartItem: repetir a mesma idempotencyKey não chama addNativeCartItem duas vezes nem duplica o item", async () => {
  let callCount = 0;
  const deps = {
    resolveNativeVariantByWooProductId: async () => ({ productId: "p-1", productVariantId: "v-1" }),
    addNativeCartItem: async () => {
      callCount += 1;
      return { productVariantId: "v-1", quantity: 2n };
    },
  };
  const input = { wooProductId: 42, quantity: 2, idempotencyKey: "22222222-2222-2222-2222-222222222222" };

  const first = await handleAddNativeCartItem("cart-1", guestOwner, input, deps);
  const second = await handleAddNativeCartItem("cart-1", guestOwner, input, deps);

  assert.equal(callCount, 1, "addNativeCartItem deve ser chamado apenas uma vez para a mesma idempotencyKey");
  assert.deepEqual(first.data, second.data);
});

test("handleAddNativeCartItem: idempotencyKey diferente permite uma segunda chamada real", async () => {
  let callCount = 0;
  const deps = {
    resolveNativeVariantByWooProductId: async () => ({ productId: "p-1", productVariantId: "v-1" }),
    addNativeCartItem: async () => {
      callCount += 1;
      return { productVariantId: "v-1", quantity: 1n };
    },
  };
  await handleAddNativeCartItem("cart-1", guestOwner, { wooProductId: 42, quantity: 1, idempotencyKey: "33333333-3333-3333-3333-333333333333" }, deps);
  await handleAddNativeCartItem("cart-1", guestOwner, { wooProductId: 42, quantity: 1, idempotencyKey: "44444444-4444-4444-4444-444444444444" }, deps);
  assert.equal(callCount, 2);
});

test("handleAddNativeCartItem mapeia CART_OWNERSHIP_INVALID para 403", async () => {
  const result = await handleAddNativeCartItem(
    "cart-1",
    guestOwner,
    { wooProductId: 1, quantity: 1, idempotencyKey: "55555555-5555-5555-5555-555555555555" },
    {
      resolveNativeVariantByWooProductId: async () => ({ productId: "p-1", productVariantId: "v-1" }),
      addNativeCartItem: async () => { throw new Error("CART_OWNERSHIP_INVALID"); },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test("handleUpdateNativeCartItem: quantidade repetida com a mesma idempotencyKey não chama a mutação duas vezes", async () => {
  let callCount = 0;
  const deps = {
    updateNativeCartItemQuantity: async () => {
      callCount += 1;
      return { productVariantId: "v-1", quantity: 5n };
    },
  };
  const input = { quantity: 5, idempotencyKey: "66666666-6666-6666-6666-666666666666" };
  await handleUpdateNativeCartItem("cart-1", "v-1", guestOwner, input, deps);
  await handleUpdateNativeCartItem("cart-1", "v-1", guestOwner, input, deps);
  assert.equal(callCount, 1);
});

test("handleRemoveNativeCartItem: chave repetida não chama a remoção duas vezes", async () => {
  let callCount = 0;
  const deps = {
    removeNativeCartItem: async () => {
      callCount += 1;
      return true;
    },
  };
  const input = { idempotencyKey: "77777777-7777-7777-7777-777777777777" };
  const first = await handleRemoveNativeCartItem("cart-1", "v-1", guestOwner, input, deps);
  const second = await handleRemoveNativeCartItem("cart-1", "v-1", guestOwner, input, deps);
  assert.equal(callCount, 1);
  assert.deepEqual(first.data, second.data);
});

test("handleRemoveNativeCartItem mapeia CART_ITEM_NOT_FOUND para 404", async () => {
  const result = await handleRemoveNativeCartItem(
    "cart-1",
    "v-1",
    guestOwner,
    { idempotencyKey: "88888888-8888-8888-8888-888888888888" },
    { removeNativeCartItem: async () => { throw new Error("CART_ITEM_NOT_FOUND"); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});
