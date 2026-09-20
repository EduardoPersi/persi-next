import assert from "node:assert/strict";
import test from "node:test";
import {
  submitNativeCommerceCheckout,
  NativeCheckoutError,
} from "../services/checkout/nativeCheckoutService.ts";

// Every DB-facing and provider-facing seam is mocked here — no network
// call, no DB round trip. Real-Postgres E2E/idempotency/concurrency proofs
// for the SAME orchestration live in
// scripts/database/native-checkout-payment-e2e.mjs and
// scripts/database/native-checkout-payment-concurrency.mjs.

const billingAddress = { recipient: "Maria Silva", street: "Rua A", number: "1", neighborhood: "Centro", city: "Jundiaí", state: "SP", postalCode: "13201000" };
const shippingAddress = billingAddress;

const baseInput = {
  checkoutId: "checkout-1",
  expectedVersion: 3n,
  idempotencyKey: "idemcheckout00000000000000000001",
  customerId: null,
  guestToken: "a".repeat(40),
  expectedPiiFingerprint: "f".repeat(64),
  expectedDestinationFingerprint: "d".repeat(64),
  contactName: "Maria Silva",
  contactEmail: "maria@example.invalid",
  billingAddress,
  shippingAddress,
};

function fakeOrder(overrides = {}) {
  return {
    id: "order-1",
    orderNumber: "PST-0001-000001",
    grandTotalMinor: 12345n,
    currency: "BRL",
    ...overrides,
  };
}

function baseMocks(overrides = {}) {
  return {
    submitCheckout: async () => ({ orderId: "order-1", orderNumber: "PST-0001-000001", orderStatus: "pending", checkoutStatus: "order_created", checkoutVersion: 4n }),
    readOrder: async () => fakeOrder(),
    ...overrides,
  };
}

// Every adapter (Inter/Mercado Pago/PagBank) drives the SAME ledger call
// sequence internally: createAttempt (created) -> claim transitionAttempt
// (created->pending) -> provider call -> attach-reference transitionAttempt
// (pending->pending) -> applyVerifiedTransition. This fake reproduces that
// sequence purely in memory so these tests never touch Postgres — the
// REAL ledger's own idempotency/concurrency/atomicity is proven instead by
// scripts/database/native-checkout-payment-{e2e,concurrency}.mjs.
function fakeLedgerDeps(provider, method) {
  let version = 0n;
  const attempt = (overrides = {}) => ({
    id: "attempt-1", orderId: "order-1", provider, method, status: "created",
    amountMinor: 12345n, currency: "BRL", idempotencyKey: "idemcheckout00000000000000000001",
    providerReference: null, providerStatus: null, failureCode: null, failureReason: null, version,
    ...overrides,
  });
  return {
    createAttempt: async () => attempt(),
    transitionAttempt: async (input) => { version += 1n; return attempt({ status: "pending", version, providerReference: input.providerReference, providerStatus: input.providerStatus }); },
    applyVerifiedTransition: async (input) => ({ paymentAttemptId: input.attemptId, paymentStatus: input.resultingStatus ?? "pending", paymentVersion: version, paymentEventId: "evt-1", paymentEventProcessingResult: "applied", orderId: "order-1", orderStatus: "pending", orderTransitioned: false, inventoryConfirmedCount: 0, inventoryReleasedCount: 0 }),
  };
}

// ---------- fail-closed routing (Section 7) ----------

test("submitNativeCommerceCheckout falha fechado para método de pagamento desconhecido, sem tocar em nenhuma authority", async () => {
  let submitCalled = false;
  const mocks = baseMocks({ submitCheckout: async () => { submitCalled = true; throw new Error("não deveria ser chamado"); } });

  await assert.rejects(
    submitNativeCommerceCheckout({ ...baseInput, payment: { method: "boleto_bancario_generico" } }, mocks),
    NativeCheckoutError,
  );
  assert.equal(submitCalled, false);
});

// ---------- order-before-provider (Section 15) + amount authority (Section 8) ----------

test("createNativeInterPixPayment (via routing) usa o valor autoritativo do native order, nunca de input do chamador", async () => {
  let capturedAmount = null;
  const mocks = baseMocks({
    interPix: {
      ...fakeLedgerDeps("banco_inter", "pix"),
      createCharge: async (input) => { capturedAmount = input.amount; return { txid: "TX1", status: "ATIVA", qrCodeCopyPaste: "00020126...", qrCodeImageBase64: "img", expiresAt: new Date().toISOString() }; },
      getCharge: async () => { throw new Error("unused"); },
      getChargeStatus: async () => { throw new Error("unused"); },
    },
  });

  const result = await submitNativeCommerceCheckout(
    { ...baseInput, payment: { method: "inter_pix", payerDocument: "52998224725", payerName: "Maria Silva", description: "Pedido" } },
    mocks,
  );

  // fakeOrder's grandTotalMinor is 12345n minor units -> 123.45 in the
  // provider's decimal amount, regardless of anything in `input`.
  assert.equal(capturedAmount, 123.45);
  assert.equal(result.method, "inter_pix");
  assert.equal(result.orderId, "order-1");
  assert.equal(result.orderNumber, "PST-0001-000001");
});

test("native order é submetido ANTES de qualquer chamada ao provedor (order-before-provider)", async () => {
  const callOrder = [];
  const mocks = baseMocks({
    submitCheckout: async (input) => { callOrder.push("submit"); return { orderId: "order-1", orderNumber: "PST-0001-000001", orderStatus: "pending", checkoutStatus: "order_created", checkoutVersion: 4n }; },
    readOrder: async () => { callOrder.push("readOrder"); return fakeOrder(); },
    mercadoPagoCard: {
      ...fakeLedgerDeps("mercado_pago", "credit_card"),
      createCharge: async () => { callOrder.push("provider"); return { chargeId: "MP-1", status: "approved", amount: 123.45, installments: 1 }; },
      getChargeStatus: async () => { throw new Error("unused"); },
    },
  });

  await submitNativeCommerceCheckout(
    { ...baseInput, payment: { method: "mercadopago_card", cardToken: "tok_abc", installments: 1, paymentMethodId: "master", holderDocument: "52998224725", holderName: "Maria Silva", holderEmail: "maria@example.invalid" } },
    mocks,
  );

  assert.deepEqual(callOrder, ["submit", "readOrder", "provider"]);
});

// ---------- routing coverage for all 5 methods ----------

test("roteia inter_boleto corretamente e propaga o DTO de apresentação sem dados sensíveis", async () => {
  const mocks = baseMocks({
    interBoleto: {
      ...fakeLedgerDeps("banco_inter", "boleto"),
      createCharge: async (input) => { assert.equal(input.billingAddress.city, "Jundiaí"); return { requestCode: "REQ-1", status: "EM_PROCESSAMENTO", digitableLine: "34191...", barcode: "341910...", dueDate: "2026-09-23" }; },
      getChargeStatus: async () => { throw new Error("unused"); },
    },
  });
  const result = await submitNativeCommerceCheckout(
    { ...baseInput, payment: { method: "inter_boleto", payerDocument: "52998224725", payerName: "Maria Silva" } },
    mocks,
  );
  assert.equal(result.method, "inter_boleto");
  assert.equal(result.digitableLine, "34191...");
  assert.doesNotMatch(JSON.stringify(result), /cardToken|payerDocument/);
});

test("roteia pagbank_apple_pay e pagbank_google_pay corretamente, sem persistir/expor o wallet token", async () => {
  const applyPayMocks = baseMocks({
    pagbankWallet: {
      ...fakeLedgerDeps("pagbank", "apple_pay"),
      createCharge: async (input) => { assert.equal(input.paymentMethod, "apple_pay"); return { chargeId: "PB-1", status: "PAID", amount: 123.45, brand: "visa", lastDigits: "4242" }; },
      getChargeStatus: async () => { throw new Error("unused"); },
    },
  });
  const apple = await submitNativeCommerceCheckout(
    { ...baseInput, payment: { method: "pagbank_apple_pay", cardToken: "wallet_tok_abc", holderDocument: "52998224725", holderName: "Maria Silva", holderEmail: "maria@example.invalid" } },
    applyPayMocks,
  );
  assert.equal(apple.method, "pagbank_apple_pay");
  assert.doesNotMatch(JSON.stringify(apple), /wallet_tok/);

  const googlePayMocks = baseMocks({
    pagbankWallet: {
      ...fakeLedgerDeps("pagbank", "google_pay"),
      createCharge: async (input) => { assert.equal(input.paymentMethod, "google_pay"); return { chargeId: "PB-2", status: "AUTHORIZED", amount: 123.45, brand: "mastercard", lastDigits: "1111" }; },
      getChargeStatus: async () => { throw new Error("unused"); },
    },
  });
  const google = await submitNativeCommerceCheckout(
    { ...baseInput, payment: { method: "pagbank_google_pay", cardToken: "wallet_tok_xyz", holderDocument: "52998224725", holderName: "Maria Silva", holderEmail: "maria@example.invalid" } },
    googlePayMocks,
  );
  assert.equal(google.method, "pagbank_google_pay");
  assert.doesNotMatch(JSON.stringify(google), /wallet_tok/);
});

// ---------- failure matrix A/B/C: stale price/shipping/inventory -> zero payment side-effects ----------

test("checkout stale (preço/frete/estoque) rejeitado por submitNativeCheckout nunca chega ao provider", async () => {
  let providerCalled = false;
  const mocks = baseMocks({
    submitCheckout: async () => { throw new Error("CHECKOUT_PRICE_STALE"); },
    mercadoPagoCard: { createCharge: async () => { providerCalled = true; throw new Error("não deveria ser chamado"); }, getChargeStatus: async () => { throw new Error("unused"); } },
  });

  await assert.rejects(
    submitNativeCommerceCheckout(
      { ...baseInput, payment: { method: "mercadopago_card", cardToken: "tok", installments: 1, paymentMethodId: "master", holderDocument: "52998224725", holderName: "Maria Silva", holderEmail: "maria@example.invalid" } },
      mocks,
    ),
    /CHECKOUT_PRICE_STALE/,
  );
  assert.equal(providerCalled, false);
});
