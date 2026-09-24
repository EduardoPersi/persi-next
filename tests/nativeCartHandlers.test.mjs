import assert from "node:assert/strict";
import test from "node:test";
import {
  handleAddNativeCartItem,
  handleCreateOrGetNativeCart,
  handleGetNativeCart,
  handleRemoveNativeCartItem,
  handleUpdateNativeCartItem,
} from "../lib/commerce/nativeCartHandlers.ts";
import { hashGuestCartToken } from "../lib/db/nativeCart.ts";
import { clearIdempotencyCacheForTests } from "../lib/commerce/nativeCommerceIdempotency.ts";

// Every DB/catalog seam here is injected via `deps` -- no Postgres
// connection, no import of anything under services/woocommerce (confirmed
// separately by tests/nativeCommerceStagingNoWooImports.test.mjs). Real
// end-to-end DB behavior for these same SQL functions is already proven by
// scripts/database/native-cart-*-concurrency.mjs.

const store = { storeId: "store-1", currency: "BRL" };
const guestOwner = { customerId: null, guestToken: "guest-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
const otherGuestOwner = { customerId: null, guestToken: "guest-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" };

// `status` lets tests exercise both an open ("active") and a mid-checkout
// ("locked") cart with the exact same ownership fixture -- the whole point
// of the 2026-09-23 fix is that ownership failure must respond identically
// (404) regardless of this value. guestTokenFingerprint must be the REAL
// hash of guestOwner.guestToken -- ownsCart/canAccessNativeCart run a real
// timingSafeEqual comparison against it (verifyGuestCartToken), so a fake
// placeholder string would make even the legitimate owner fail ownership.
function ownedCart(overrides = {}) {
  return { id: "cart-1", storeId: store.storeId, customerId: null, guestTokenFingerprint: hashGuestCartToken(guestOwner.guestToken), currency: "BRL", status: "active", version: 1n, items: [], ...overrides };
}

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
      readNativeCartById: async () => ownedCart(),
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
    readNativeCartById: async () => ownedCart(),
  });
  assert.equal(result.ok, true);
  // Same value as the incoming cookie, not a freshly generated one -- this
  // still resets the cookie's Max-Age on the response (a sliding 30-day
  // expiration), which is intentional, not a leftover default.
  assert.equal(result.setGuestToken, guestOwner.guestToken);
});

// ---------- achados do smoke test de staging, 2026-09-24 ----------

test("handleCreateOrGetNativeCart: 10 chamadas concorrentes com o mesmo cookie resultam em 1 carrinho, 0 erros", async () => {
  // Simula o próprio contrato idempotente do create_native_cart real
  // (SELECT ... FOR UPDATE antes do INSERT): enquanto o carrinho do dono
  // continuar 'active', toda chamada concorrente recebe a MESMA linha,
  // nunca uma exceção -- reproduz "duplo clique/duas abas" contra um
  // carrinho ainda aberto (o caso que já funcionava) para servir de linha
  // de base ao teste de recuperação de conflito logo abaixo.
  let created = false;
  let sharedCart;
  const deps = {
    resolveSingleActiveStore: async () => store,
    generateGuestCartToken: () => { throw new Error("não deveria gerar um novo token -- o cookie já existe"); },
    createNativeCart: async () => {
      if (!created) {
        created = true;
        sharedCart = { id: "cart-shared", storeId: store.storeId, customerId: null, currency: "BRL", status: "active", version: 0n, createdAt: new Date().toISOString() };
      }
      return sharedCart;
    },
    findNativeCartByGuestTokenAnyStatus: async () => { throw new Error("não deveria ser chamado -- não há conflito neste cenário"); },
    readNativeCartById: async (id) => ({ id, storeId: store.storeId, customerId: null, guestTokenFingerprint: "fp", currency: "BRL", status: "active", version: 0n, items: [] }),
  };
  const results = await Promise.all(Array.from({ length: 10 }, () => handleCreateOrGetNativeCart(guestOwner, deps)));
  assert.ok(results.every((r) => r.ok), "todas as 10 chamadas devem ter sucesso, nenhum erro");
  const cartIds = new Set(results.map((r) => r.data.id));
  assert.equal(cartIds.size, 1, "todas as chamadas devem apontar para o MESMO carrinho");
});

test("handleCreateOrGetNativeCart: 23505 (guest já ligado a um carrinho não mais ativo) é recuperado por leitura -- devolve o carrinho existente com 200, nunca um erro cru", async () => {
  // Reproduz o incidente de staging: o carrinho do convidado já está
  // 'locked' (checkout em andamento) quando um duplo clique/segunda aba
  // chama "obter ou criar" de novo. create_native_cart não encontra um
  // carrinho ATIVO, tenta inserir, e colide com carts_guest_token_unique
  // (índice único global, sem filtro de status) -- ver o comentário em
  // createNativeCart (lib/db/nativeCart.ts) para a causa raiz completa.
  const lockedCart = { id: "cart-locked", storeId: store.storeId, customerId: null, currency: "BRL", status: "locked", version: 1n, createdAt: new Date(Date.now() - 60_000).toISOString() };
  const conflict = new Error("Failed query: insert into carts ...");
  conflict.cause = Object.assign(new Error('duplicate key value violates unique constraint "carts_guest_token_unique"'), { code: "23505" });
  let findCalled = false;
  const deps = {
    resolveSingleActiveStore: async () => store,
    generateGuestCartToken: () => { throw new Error("não deveria ser chamado -- o cookie já existe"); },
    createNativeCart: async () => { throw conflict; },
    findNativeCartByGuestTokenAnyStatus: async () => { findCalled = true; return lockedCart; },
    readNativeCartById: async (id) => ({ id, storeId: store.storeId, customerId: null, guestTokenFingerprint: "fp", currency: "BRL", status: "locked", version: 1n, items: [] }),
  };
  const result = await handleCreateOrGetNativeCart(guestOwner, deps);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200, "carrinho reaproveitado responde 200, não 201 (esse não é um recurso recém-criado)");
  assert.equal(result.data.id, "cart-locked");
  assert.ok(findCalled);
});

test("handleCreateOrGetNativeCart: um 23505 sem carrinho correspondente (conflito genuinamente inesperado) ainda vira 502 logado, nunca escapa cru", async (t) => {
  t.mock.method(console, "error", () => {});
  const conflict = new Error("Failed query: insert into carts ...");
  conflict.cause = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
  const deps = {
    resolveSingleActiveStore: async () => store,
    generateGuestCartToken: () => { throw new Error("não deveria ser chamado"); },
    createNativeCart: async () => { throw conflict; },
    findNativeCartByGuestTokenAnyStatus: async () => null,
    readNativeCartById: async () => { throw new Error("não deveria ser chamado"); },
  };
  const result = await handleCreateOrGetNativeCart(guestOwner, deps);
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(console.error.mock.calls.length, 1);
});

test("handleCreateOrGetNativeCart: cart.createdAt no passado (create_native_cart's própria idempotência encontrou uma linha pré-existente) responde 200, não 201", async () => {
  // Mesmo sem nenhum conflito/exceção, create_native_cart pode devolver uma
  // linha que já existia (seu próprio "SELECT ... FOR UPDATE" antes do
  // INSERT) -- o status HTTP (200 vs 201) é o sinal observável ao cliente
  // de created-vs-reused; o nome do evento de log (native_cart_created vs
  // native_cart_reused) é derivado do mesmo booleano internamente e não
  // teve um jeito confiável de ser verificado via mock de console neste
  // test runner, então esta asserção fica no contrato observável (status).
  const reusedCart = { id: "cart-1", storeId: store.storeId, customerId: null, currency: "BRL", status: "active", version: 0n, createdAt: new Date(Date.now() - 60_000).toISOString() };
  const deps = {
    resolveSingleActiveStore: async () => store,
    generateGuestCartToken: () => { throw new Error("não deveria ser chamado"); },
    createNativeCart: async () => reusedCart,
    findNativeCartByGuestTokenAnyStatus: async () => { throw new Error("não deveria ser chamado"); },
    readNativeCartById: async (id) => ({ id, storeId: store.storeId, customerId: null, guestTokenFingerprint: "fp", currency: "BRL", status: "active", version: 0n, items: [] }),
  };
  const result = await handleCreateOrGetNativeCart(guestOwner, deps);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200, "carrinho com createdAt no passado deve ser tratado como reaproveitado (200), não recém-criado (201)");
});

test("handleCreateOrGetNativeCart: cart.createdAt no momento da chamada (recém-inserido) responde 201", async () => {
  const deps = {
    resolveSingleActiveStore: async () => store,
    generateGuestCartToken: () => { throw new Error("não deveria ser chamado"); },
    createNativeCart: async () => ({ id: "cart-1", storeId: store.storeId, customerId: null, currency: "BRL", status: "active", version: 0n, createdAt: new Date().toISOString() }),
    findNativeCartByGuestTokenAnyStatus: async () => { throw new Error("não deveria ser chamado"); },
    readNativeCartById: async (id) => ({ id, storeId: store.storeId, customerId: null, guestTokenFingerprint: "fp", currency: "BRL", status: "active", version: 0n, items: [] }),
  };
  const result = await handleCreateOrGetNativeCart(guestOwner, deps);
  assert.equal(result.ok, true);
  assert.equal(result.status, 201, "carrinho recém-inserido deve responder 201");
});

// ---------- unmapped product fails closed (mandatory) ----------

test("handleAddNativeCartItem falha fechado (404) para um produto Woo sem mapeamento nativo, sem tentar mutar o carrinho", async () => {
  let addCalled = false;
  const result = await handleAddNativeCartItem(
    "cart-1",
    guestOwner,
    { wooProductId: 999, quantity: 1, idempotencyKey: "11111111-1111-1111-1111-111111111111" },
    {
      readNativeCartById: async () => ownedCart(),
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
    readNativeCartById: async () => ownedCart(),
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
    readNativeCartById: async () => ownedCart(),
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

test("handleAddNativeCartItem mapeia CART_OWNERSHIP_INVALID (vindo da SQL) para 404 -- defesa em profundidade", async () => {
  // A pré-checagem de ownership em TS (abaixo) já deveria interceptar
  // isso antes de chegar aqui; este teste cobre o caso em que, mesmo
  // assim, a própria função SQL de mutação relata ownership inválido
  // (ex.: corrida entre a leitura do carrinho e a mutação).
  const result = await handleAddNativeCartItem(
    "cart-1",
    guestOwner,
    { wooProductId: 1, quantity: 1, idempotencyKey: "55555555-5555-5555-5555-555555555555" },
    {
      readNativeCartById: async () => ownedCart(),
      resolveNativeVariantByWooProductId: async () => ({ productId: "p-1", productVariantId: "v-1" }),
      addNativeCartItem: async () => { throw new Error("CART_OWNERSHIP_INVALID"); },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "CART_NOT_FOUND");
});

// ---------- ownership antes de estado (achado do smoke test de staging, 2026-09-23) ----------

test("handleAddNativeCartItem: cookie de outro dono contra um carrinho ABERTO responde 404, sem chamar addNativeCartItem", async () => {
  let addCalled = false;
  const result = await handleAddNativeCartItem(
    "cart-1",
    otherGuestOwner,
    { wooProductId: 1, quantity: 1, idempotencyKey: "10101010-1010-1010-1010-101010101010" },
    {
      readNativeCartById: async () => ownedCart({ status: "active" }),
      resolveNativeVariantByWooProductId: async () => ({ productId: "p-1", productVariantId: "v-1" }),
      addNativeCartItem: async () => { addCalled = true; return { productVariantId: "v-1", quantity: 1n }; },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "CART_NOT_FOUND");
  assert.equal(addCalled, false, "a mutação nunca deve ser chamada quando o ownership falha na pré-checagem");
});

test("handleAddNativeCartItem: cookie de outro dono contra um carrinho EM CHECKOUT (locked) também responde 404, não 409", async () => {
  // Este é exatamente o cenário do achado em staging: add_native_cart_item
  // checa o ESTADO do carrinho (CART_NOT_MUTABLE, 409) antes de checar
  // ownership -- um carrinho locked com cookie errado vazava 409 em vez de
  // 404, revelando que o carrinho existe e está em checkout. A pré-checagem
  // de ownership em TypeScript intercepta isso antes de a função SQL ser
  // sequer chamada, então o estado do carrinho nunca chega a importar aqui.
  let addCalled = false;
  const result = await handleAddNativeCartItem(
    "cart-1",
    otherGuestOwner,
    { wooProductId: 1, quantity: 1, idempotencyKey: "20202020-2020-2020-2020-202020202020" },
    {
      readNativeCartById: async () => ownedCart({ status: "locked" }),
      resolveNativeVariantByWooProductId: async () => ({ productId: "p-1", productVariantId: "v-1" }),
      addNativeCartItem: async () => { addCalled = true; return { productVariantId: "v-1", quantity: 1n }; },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "CART_NOT_FOUND");
  assert.equal(addCalled, false);
});

test("handleAddNativeCartItem: carrinho inexistente responde 404 idêntico ao de ownership inválida", async () => {
  const result = await handleAddNativeCartItem(
    "cart-1",
    guestOwner,
    { wooProductId: 1, quantity: 1, idempotencyKey: "30303030-3030-3030-3030-303030303030" },
    {
      readNativeCartById: async () => null,
      resolveNativeVariantByWooProductId: async () => { throw new Error("não deveria ser chamado"); },
      addNativeCartItem: async () => { throw new Error("não deveria ser chamado"); },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "CART_NOT_FOUND");
});

// ---------- extração real de erro do Postgres (achado do smoke test de staging, 2026-09-23) ----------

test("handleAddNativeCartItem reconhece um erro real da SQL mesmo quando embrulhado em .cause (forma real do drizzle-orm)", async () => {
  const wrapped = new Error("Failed query: insert into ...");
  wrapped.cause = new Error("CART_QUANTITY_INVALID");
  const result = await handleAddNativeCartItem(
    "cart-1",
    guestOwner,
    { wooProductId: 1, quantity: 1, idempotencyKey: "99999999-9999-9999-9999-999999999999" },
    {
      readNativeCartById: async () => ownedCart(),
      resolveNativeVariantByWooProductId: async () => ({ productId: "p-1", productVariantId: "v-1" }),
      addNativeCartItem: async () => { throw wrapped; },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(result.code, "CART_QUANTITY_INVALID");
});

test("handleAddNativeCartItem: um erro genuinamente desconhecido vira 502 e é logado como native_commerce_unexpected_error, sem PII", async (t) => {
  t.mock.method(console, "error", () => {});
  const dbError = new Error("Failed query: insert into ...");
  dbError.cause = Object.assign(new Error("alguma falha interna do Postgres"), { code: "53300" });
  const result = await handleAddNativeCartItem(
    "cart-1",
    guestOwner,
    { wooProductId: 1, quantity: 1, idempotencyKey: "88888888-8888-8888-8888-888888888888" },
    {
      readNativeCartById: async () => ownedCart(),
      resolveNativeVariantByWooProductId: async () => ({ productId: "p-1", productVariantId: "v-1" }),
      addNativeCartItem: async () => { throw dbError; },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(console.error.mock.calls.length, 1);
  const [eventName, fields] = console.error.mock.calls[0].arguments;
  assert.match(eventName, /native_commerce_unexpected_error/);
  assert.equal(fields.code, "53300");
  assert.equal(fields.route, "POST /api/cart/native/items");
  const serialized = JSON.stringify(fields);
  assert.doesNotMatch(serialized, /alguma falha interna do Postgres/, "a mensagem crua do banco nunca deve ir para o log");
  for (const forbidden of [/email/i, /phone/i, /cpf/i, /cnpj/i, /endereco/i, /address/i]) {
    assert.doesNotMatch(serialized, forbidden);
  }
});

test("handleUpdateNativeCartItem: quantidade repetida com a mesma idempotencyKey não chama a mutação duas vezes", async () => {
  let callCount = 0;
  const deps = {
    readNativeCartById: async () => ownedCart(),
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

test("handleUpdateNativeCartItem: cookie de outro dono contra carrinho em checkout responde 404, não 409", async () => {
  let updateCalled = false;
  const result = await handleUpdateNativeCartItem(
    "cart-1",
    "v-1",
    otherGuestOwner,
    { quantity: 3, idempotencyKey: "40404040-4040-4040-4040-404040404040" },
    {
      readNativeCartById: async () => ownedCart({ status: "locked" }),
      updateNativeCartItemQuantity: async () => { updateCalled = true; return { productVariantId: "v-1", quantity: 3n }; },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(updateCalled, false);
});

test("handleRemoveNativeCartItem: chave repetida não chama a remoção duas vezes", async () => {
  let callCount = 0;
  const deps = {
    readNativeCartById: async () => ownedCart(),
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
    {
      readNativeCartById: async () => ownedCart(),
      removeNativeCartItem: async () => { throw new Error("CART_ITEM_NOT_FOUND"); },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("handleRemoveNativeCartItem: cookie de outro dono contra carrinho aberto responde 404, sem chamar removeNativeCartItem", async () => {
  let removeCalled = false;
  const result = await handleRemoveNativeCartItem(
    "cart-1",
    "v-1",
    otherGuestOwner,
    { idempotencyKey: "50505050-5050-5050-5050-505050505050" },
    {
      readNativeCartById: async () => ownedCart({ status: "active" }),
      removeNativeCartItem: async () => { removeCalled = true; return true; },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(removeCalled, false);
});
