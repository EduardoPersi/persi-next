import assert from "node:assert/strict";
import test from "node:test";
import {
  handleMarkNativeCheckoutReady,
  handlePersistNativeCheckoutPii,
  handlePrepareNativeCheckout,
} from "../lib/commerce/nativeCheckoutPrepHandlers.ts";
import { CheckoutPiiValidationError } from "../lib/commerce/checkoutPii.ts";
import { hashGuestCartToken } from "../lib/db/nativeCart.ts";
import { clearIdempotencyCacheForTests } from "../lib/commerce/nativeCommerceIdempotency.ts";

const store = { storeId: "store-1", currency: "BRL" };
const guestOwner = { customerId: null, guestToken: "guest-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
const otherGuestOwner = { customerId: null, guestToken: "guest-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" };

// guestTokenFingerprint must be the REAL hash of guestOwner.guestToken --
// ownsCart/canAccessNativeCart/requireOwnedCheckout run a real
// timingSafeEqual comparison against it, so a fake placeholder string
// would make even the legitimate owner fail ownership.
function baseCart(overrides = {}) {
  return {
    id: "cart-1", storeId: store.storeId, customerId: null, guestTokenFingerprint: hashGuestCartToken(guestOwner.guestToken),
    currency: "BRL", status: "active", version: 3n,
    items: [{ id: "item-1", productVariantId: "v-1", quantity: 2n }],
    ...overrides,
  };
}

function baseCheckout(overrides = {}) {
  return { id: "checkout-1", storeId: store.storeId, cartId: "cart-1", customerId: null, status: "validating", currency: "BRL", version: 1n, ...overrides };
}

function basePiiDeps(overrides = {}) {
  return {
    readNativeCheckoutOwnership: async () => baseCheckout(),
    readNativeCartById: async () => baseCart(),
    persistNativeCheckoutPii: async () => ({ checkoutId: "checkout-1", checkoutVersion: 2n, fingerprint: "a".repeat(64), destinationFingerprint: "b".repeat(64) }),
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
  const deps = basePiiDeps({ persistNativeCheckoutPii: async () => { callCount += 1; return { checkoutId: "checkout-1", checkoutVersion: 2n, fingerprint: "a".repeat(64), destinationFingerprint: "b".repeat(64) }; } });
  const input = { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "66666666-6666-6666-6666-666666666666", pii: { any: "shape" } };
  await handlePersistNativeCheckoutPii(guestOwner, input, deps);
  await handlePersistNativeCheckoutPii(guestOwner, input, deps);
  assert.equal(callCount, 1);
});

// ---------- achado do smoke test de staging, 2026-09-25 ----------

test("handlePersistNativeCheckoutPii: a resposta de sucesso inclui fingerprint e destinationFingerprint (sem eles, ready nunca pode ser chamado com sucesso)", async () => {
  const result = await handlePersistNativeCheckoutPii(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "12121212-1212-1212-1212-121212121212", pii: {} },
    basePiiDeps({ persistNativeCheckoutPii: async () => ({ checkoutId: "checkout-1", checkoutVersion: 7n, fingerprint: "c".repeat(64), destinationFingerprint: "d".repeat(64) }) }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.fingerprint, "c".repeat(64));
  assert.equal(result.data.destinationFingerprint, "d".repeat(64));
});

test("fluxo pii -> ready: o fingerprint que a resposta de pii devolve é exatamente o que precisa ser repassado a ready (reproduz o bug de staging)", async () => {
  // Antes desta correção, handlePersistNativeCheckoutPii não devolvia
  // `fingerprint` -- um script/cliente correto (que só pode conhecer o
  // fingerprint através dessa resposta, já que é um HMAC calculado no
  // servidor com uma chave que o cliente nunca tem) só conseguia enviar um
  // valor inventado a ready, que a SQL de mark_native_checkout_ready
  // rejeitava com CHECKOUT_PII_REQUIRED_OR_EXPIRED (mismatch de
  // fingerprint, não PII de fato ausente/expirado).
  const piiResult = await handlePersistNativeCheckoutPii(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "3", idempotencyKey: "13131313-1313-1313-1313-131313131313", pii: {} },
    basePiiDeps({ persistNativeCheckoutPii: async () => ({ checkoutId: "checkout-1", checkoutVersion: 4n, fingerprint: "e".repeat(64), destinationFingerprint: "f".repeat(64) }) }),
  );
  assert.equal(piiResult.ok, true);

  let capturedExpectedFingerprint;
  const readyResult = await handleMarkNativeCheckoutReady(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: piiResult.data.checkoutVersion, expectedPiiFingerprint: piiResult.data.fingerprint },
    { markNativeCheckoutReady: async (input) => { capturedExpectedFingerprint = input.expectedPiiFingerprint; return { id: "checkout-1" }; } },
  );
  assert.equal(readyResult.ok, true);
  assert.equal(capturedExpectedFingerprint, "e".repeat(64), "ready deve receber exatamente o fingerprint que pii devolveu, não um placeholder");
});

test("handlePersistNativeCheckoutPii falha fechado (422) sem customerId nem guestToken", async () => {
  const result = await handlePersistNativeCheckoutPii(
    { customerId: null, guestToken: null },
    { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "77777777-7777-7777-7777-777777777777", pii: {} },
    basePiiDeps({ persistNativeCheckoutPii: async () => { throw new Error("não deveria ser chamado"); } }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
});

// ---------- ownership antes de estado (achado do smoke test de staging, 2026-09-23) ----------

test("handlePersistNativeCheckoutPii: cookie de outro dono contra checkout ABERTO (validating) responde 404, sem chamar persistNativeCheckoutPii", async () => {
  let persistCalled = false;
  const result = await handlePersistNativeCheckoutPii(
    otherGuestOwner,
    { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "60606060-6060-6060-6060-606060606060", pii: {} },
    basePiiDeps({
      readNativeCheckoutOwnership: async () => baseCheckout({ status: "validating" }),
      persistNativeCheckoutPii: async () => { persistCalled = true; return { checkoutId: "checkout-1", checkoutVersion: 2n }; },
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "CHECKOUT_NOT_FOUND");
  assert.equal(persistCalled, false, "a mutação nunca deve ser chamada quando o ownership falha na pré-checagem");
});

test("handlePersistNativeCheckoutPii: cookie de outro dono contra checkout EM ready (equivalente a 'locked') também responde 404, não um código de estado", async () => {
  // persist_checkout_pii (20260904010000_secure_checkout_pii_foundation.sql)
  // checa CHECKOUT_STATE_INVALID antes de CHECKOUT_OWNER_DENIED -- um
  // checkout já 'ready' com cookie errado vazaria um 409/422 de estado em
  // vez de 404. A pré-checagem de ownership em TypeScript intercepta isso
  // antes de a função SQL ser sequer chamada.
  let persistCalled = false;
  const result = await handlePersistNativeCheckoutPii(
    otherGuestOwner,
    { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "70707070-7070-7070-7070-707070707070", pii: {} },
    basePiiDeps({
      readNativeCheckoutOwnership: async () => baseCheckout({ status: "ready" }),
      persistNativeCheckoutPii: async () => { persistCalled = true; return { checkoutId: "checkout-1", checkoutVersion: 2n }; },
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "CHECKOUT_NOT_FOUND");
  assert.equal(persistCalled, false);
});

test("handlePersistNativeCheckoutPii: checkout inexistente responde 404 idêntico ao de ownership inválida", async () => {
  const result = await handlePersistNativeCheckoutPii(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "80808080-8080-8080-8080-808080808080", pii: {} },
    basePiiDeps({
      readNativeCheckoutOwnership: async () => null,
      persistNativeCheckoutPii: async () => { throw new Error("não deveria ser chamado"); },
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.code, "CHECKOUT_NOT_FOUND");
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

test("handlePersistNativeCheckoutPii mapeia CHECKOUT_OWNER_DENIED (vindo da SQL) para 404 -- defesa em profundidade", async () => {
  // A pré-checagem de ownership em TS já deveria interceptar isso antes de
  // chegar aqui (testes acima); este cobre o caso em que a própria SQL
  // ainda assim relata ownership inválido.
  const result = await handlePersistNativeCheckoutPii(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", pii: {} },
    basePiiDeps({ persistNativeCheckoutPii: async () => { throw new Error("checkout_owner_denied"); } }), // casing real varia entre migrations
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("handlePersistNativeCheckoutPii mapeia CheckoutPiiValidationError para 422 com o nome do campo, nunca o valor", async () => {
  const result = await handlePersistNativeCheckoutPii(
    guestOwner,
    {
      checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      pii: { contact: { firstName: "Maria", lastName: "Silva", email: "maria@example.com", phone: "11987654321", personType: "fisica", taxDocument: "11144477735" } },
    },
    basePiiDeps({ persistNativeCheckoutPii: async () => { throw new CheckoutPiiValidationError("billing.postalCode"); } }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(result.code, "CHECKOUT_PII_INVALID");
  assert.equal(result.field, "billing.postalCode");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /Maria|Silva|maria@example\.com|11987654321|11144477735/, "o campo aponta o NOME, nunca o valor rejeitado");
});

// ---------- achado do smoke test de staging, 2026-09-24 ----------

test("handlePersistNativeCheckoutPii: um 42501 (permissão negada) durante a pré-checagem de ownership nunca escapa sem tratamento -- vira 502 logado, não um erro cru do Next.js", async (t) => {
  // Reproduz exatamente o incidente de staging: readNativeCheckoutOwnership
  // (chamado dentro da pré-checagem de ownership, ANTES de qualquer
  // try/catch "local" -- ver o comentário de requireOwnedCheckout) falha
  // com um 42501 real, no formato exato que o drizzle-orm produz (a
  // mensagem do Postgres embrulhada em .cause, nunca em error.message
  // diretamente -- lib/db/postgresErrorMessage.ts). O bug original era o
  // erro escapar inteiro, cru, para o log padrão do Next.js; a correção é
  // que o try/catch que envolve TODO o corpo do handler (não só a mutação
  // final) sempre intercepta isso.
  t.mock.method(console, "error", () => {});
  const permissionDenied = new Error(
    'Failed query: select * from public.checkout_sessions s left join lateral (select coalesce(jsonb_agg(...),\'[]\') from public.inventory_reservations r ...) x on true where s.id = $1',
  );
  permissionDenied.cause = Object.assign(
    new Error('permission denied for table inventory_reservations'),
    { code: "42501" },
  );
  const result = await handlePersistNativeCheckoutPii(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "dddddddd-dddd-dddd-dddd-dddddddddddd", pii: {} },
    basePiiDeps({ readNativeCheckoutOwnership: async () => { throw permissionDenied; } }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(console.error.mock.calls.length, 1);
  const [eventName, fields] = console.error.mock.calls[0].arguments;
  assert.match(eventName, /native_commerce_unexpected_error/);
  assert.equal(fields.code, "42501");
  assert.equal(fields.route, "POST /api/checkout/native/pii");
  const serialized = JSON.stringify(fields);
  assert.doesNotMatch(serialized, /inventory_reservations|checkout_sessions|permission denied|select \*/i, "nenhum SQL cru, nenhum nome de tabela, nenhuma mensagem do Postgres pode ir para o log");
});

test("handlePersistNativeCheckoutPii: chave de criptografia de PII ausente (CHECKOUT_PII_KEY_ID_INVALID) responde 503 PII_ENCRYPTION_KEY_MISSING, não 502 genérico -- e nunca grava PII", async (t) => {
  // environmentCheckoutPiiKeys() (lib/commerce/checkoutPii.ts), chamada de
  // dentro de persistNativeCheckoutPii (lib/db/nativeCheckoutPii.ts),
  // lança exatamente este Error puro (sem .cause -- não é uma falha de
  // banco) quando CHECKOUT_PII_KEY_ID/CHECKOUT_PII_ENCRYPTION_KEYS_JSON
  // não estão configuradas em staging. É lançada ANTES de qualquer escrita
  // -- "nunca gravar PII sem cripto" é garantido pela própria ordem do
  // código (a criptografia acontece antes do insert), não por uma
  // checagem extra aqui.
  t.mock.method(console, "error", () => {});
  const result = await handlePersistNativeCheckoutPii(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", pii: {} },
    basePiiDeps({ persistNativeCheckoutPii: async () => { throw new Error("CHECKOUT_PII_KEY_ID_INVALID"); } }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.code, "PII_ENCRYPTION_KEY_MISSING");
  assert.equal(console.error.mock.calls.length, 1);
  const [eventName, fields] = console.error.mock.calls[0].arguments;
  assert.match(eventName, /native_commerce_unexpected_error/);
  assert.equal(fields.code, "PII_ENCRYPTION_KEY_MISSING", "o log deve ter o código estável, não Error.prototype.name genérico (\"Error\")");
});

test("handlePersistNativeCheckoutPii: chave de PII malformada (CHECKOUT_PII_HMAC_KEY_INVALID) responde 503 PII_ENCRYPTION_KEY_INVALID", async (t) => {
  t.mock.method(console, "error", () => {});
  const result = await handlePersistNativeCheckoutPii(
    guestOwner,
    { checkoutId: "checkout-1", expectedVersion: "1", idempotencyKey: "ffffffff-ffff-ffff-ffff-ffffffffffff", pii: {} },
    basePiiDeps({ persistNativeCheckoutPii: async () => { throw new Error("CHECKOUT_PII_HMAC_KEY_INVALID"); } }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.code, "PII_ENCRYPTION_KEY_INVALID");
  const [, fields] = console.error.mock.calls[0].arguments;
  assert.equal(fields.code, "PII_ENCRYPTION_KEY_INVALID");
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
