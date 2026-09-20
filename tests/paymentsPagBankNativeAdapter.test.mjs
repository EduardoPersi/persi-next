import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePagBankAttemptStatus,
  normalizePagBankError,
  createNativePagBankWalletPayment,
  createNativePagBankApplePayPayment,
  createNativePagBankGooglePayPayment,
  applyNativePagBankWebhookNotification,
  reconcileNativePagBankPendingAttempt,
  verifyNativePagBankPaymentStatus,
  NativePagBankWalletAmbiguousRetryError,
} from "../services/payments/pagbank/nativeAdapter.ts";
import { PagBankPaymentError } from "../services/payments/pagbank/errors.ts";

// Every provider/DB seam is mocked — no network call, no DB round trip.
// Real-Postgres concurrency proofs live in
// scripts/database/native-pagbank-payment-concurrency.mjs.

function baseAttempt(overrides = {}) {
  return {
    id: "attempt-1",
    orderId: "order-1",
    provider: "pagbank",
    method: "apple_pay",
    status: "created",
    amountMinor: 5000n,
    currency: "BRL",
    idempotencyKey: "idem-pb-0000000001",
    providerReference: null,
    providerStatus: null,
    failureCode: null,
    failureReason: null,
    version: 0n,
    ...overrides,
  };
}

function verifiedTransition(input, overrides = {}) {
  return {
    paymentAttemptId: input.attemptId,
    paymentStatus: input.resultingStatus ?? null,
    paymentVersion: 1n,
    paymentEventId: "evt-1",
    paymentEventProcessingResult: "applied",
    orderId: "order-1",
    orderStatus: "pending",
    orderTransitioned: false,
    inventoryConfirmedCount: 0,
    inventoryReleasedCount: 0,
    ...overrides,
  };
}

const holder = { cardToken: "wallet_tok_synthetic_abc123", holderDocument: "52998224725", holderName: "Maria Silva", holderEmail: "maria@example.invalid" };

// ---------- status normalization ----------

test("normalizePagBankAttemptStatus mapeia todos os status reais conhecidos", () => {
  assert.equal(normalizePagBankAttemptStatus("PAID"), "paid");
  assert.equal(normalizePagBankAttemptStatus("AUTHORIZED"), "authorized");
  assert.equal(normalizePagBankAttemptStatus("IN_ANALYSIS"), "pending");
  assert.equal(normalizePagBankAttemptStatus("DECLINED"), "failed");
  assert.equal(normalizePagBankAttemptStatus("CANCELED"), "cancelled");
});

// ---------- error normalization ----------

test("normalizePagBankError categoriza timeout/indisponibilidade, autenticação e validação", () => {
  assert.equal(normalizePagBankError(new PagBankPaymentError(502, "x", "PAGBANK_API_UNAVAILABLE")).category, "timeout");
  assert.equal(normalizePagBankError(new PagBankPaymentError(503, "x", "PAGBANK_CONFIG_MISSING")).category, "non_retryable");
  assert.equal(normalizePagBankError(new PagBankPaymentError(401, "x", "PAGBANK_API_ERROR")).category, "authentication");
  assert.equal(normalizePagBankError(new PagBankPaymentError(404, "x", "PAGBANK_API_ERROR")).category, "not_found");
  assert.equal(normalizePagBankError(new PagBankPaymentError(422, "x", "PAGBANK_API_ERROR")).category, "validation");
  assert.equal(normalizePagBankError(new PagBankPaymentError(500, "x", "PAGBANK_API_ERROR")).category, "provider_unavailable");
  assert.equal(normalizePagBankError(new Error("boom")).category, "provider_unavailable");
});

// ---------- Apple Pay creation ----------

test("createNativePagBankApplePayPayment cria attempt, faz o claim ANTES do provedor e nunca usa id de pedido Woo", async () => {
  const calls = { createCharge: [], transitionAttempt: [] };
  const deps = {
    createAttempt: async (input) => baseAttempt({ method: "apple_pay", idempotencyKey: input.idempotencyKey }),
    createCharge: async (input) => { calls.createCharge.push(input); return { chargeId: "PB-1", status: "PAID", amount: 50, brand: "visa", lastDigits: "4242", installments: 1 }; },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async (input) => { calls.transitionAttempt.push(input); return baseAttempt({ method: "apple_pay", idempotencyKey: "idem-pb-0000000001", status: "pending", version: BigInt(calls.transitionAttempt.length), providerReference: input.providerReference, providerStatus: input.providerStatus }); },
    applyVerifiedTransition: async (input) => verifiedTransition(input, { paymentStatus: "paid" }),
  };

  const result = await createNativePagBankApplePayPayment(
    { orderId: "order-1", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-pb-0000000001", ...holder },
    deps,
  );

  assert.equal(calls.transitionAttempt.length, 2);
  assert.equal(calls.transitionAttempt[0].providerReference, undefined); // the CLAIM happens before the provider is ever called
  assert.equal(calls.createCharge[0].paymentMethod, "apple_pay");
  assert.equal(calls.createCharge[0].referenceId, "order-1");
  assert.doesNotMatch(JSON.stringify(calls.createCharge[0]), /Woo|wc\/v3/i);
  assert.equal(result.attempt.status, "paid");
});

test("createNativePagBankGooglePayPayment usa exatamente o mesmo caminho, só muda paymentMethod", async () => {
  const calls = { createCharge: [] };
  const deps = {
    createAttempt: async (input) => baseAttempt({ method: "google_pay", idempotencyKey: input.idempotencyKey }),
    createCharge: async (input) => { calls.createCharge.push(input); return { chargeId: "PB-2", status: "AUTHORIZED", amount: 50, installments: 1 }; },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async (input) => baseAttempt({ method: "google_pay", idempotencyKey: "idem-pb-0000000002", status: "pending", version: 1n, providerReference: input.providerReference, providerStatus: input.providerStatus }),
    applyVerifiedTransition: async (input) => verifiedTransition(input, { paymentStatus: "authorized" }),
  };

  const result = await createNativePagBankGooglePayPayment(
    { orderId: "order-2", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-pb-0000000002", ...holder },
    deps,
  );
  assert.equal(calls.createCharge[0].paymentMethod, "google_pay");
  assert.equal(result.attempt.status, "authorized");
});

test("createNativePagBankWalletPayment: ao perder a corrida do claim, retorna quieto sem chamar o provedor", async () => {
  let providerCalled = false;
  const deps = {
    createAttempt: async (input) => baseAttempt({ idempotencyKey: input.idempotencyKey }),
    createCharge: async () => { providerCalled = true; throw new Error("não deveria ser chamado"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async () => { throw new Error("stale_payment_attempt_transition"); },
    applyVerifiedTransition: async () => { throw new Error("não deveria registrar evento"); },
  };

  const result = await createNativePagBankWalletPayment(
    { orderId: "order-1", walletMethod: "apple_pay", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-pb-0000000001", ...holder },
    deps,
  );
  assert.equal(providerCalled, false);
  assert.equal(result.charge, null);
});

test("createNativePagBankWalletPayment recusa retomada ambígua (pending, sem provider_reference) — PagBank não tem idempotência de provedor", async () => {
  const deps = {
    createAttempt: async () => baseAttempt({ status: "pending", providerReference: null }),
    createCharge: async () => { throw new Error("não deveria ser chamado"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async () => { throw new Error("unused"); },
    applyVerifiedTransition: async () => { throw new Error("unused"); },
  };

  await assert.rejects(
    createNativePagBankWalletPayment(
      { orderId: "order-1", walletMethod: "apple_pay", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-pb-0000000001", ...holder },
      deps,
    ),
    NativePagBankWalletAmbiguousRetryError,
  );
});

test("createNativePagBankWalletPayment é retry-safe: attempt com referência já anexada nunca chama o provedor de novo", async () => {
  let providerCalled = false;
  const deps = {
    createAttempt: async () => baseAttempt({ status: "pending", providerReference: "PB-1", providerStatus: "PAID" }),
    createCharge: async () => { providerCalled = true; throw new Error("não deveria ser chamado"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async () => { throw new Error("não deveria transicionar"); },
    applyVerifiedTransition: async () => { throw new Error("não deveria registrar evento"); },
  };

  const result = await createNativePagBankWalletPayment(
    { orderId: "order-1", walletMethod: "apple_pay", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-pb-0000000001", ...holder },
    deps,
  );
  assert.equal(providerCalled, false);
  assert.equal(result.charge, null);
});

test("createNativePagBankWalletPayment propaga timeout do provedor após o claim, sem registrar evento", async () => {
  let applyVerifiedTransitionCalled = false;
  const deps = {
    createAttempt: async (input) => baseAttempt({ idempotencyKey: input.idempotencyKey }),
    createCharge: async () => { throw new PagBankPaymentError(502, "timeout", "PAGBANK_API_UNAVAILABLE"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async (input) => baseAttempt({ status: "pending", version: 1n, providerReference: input.providerReference ?? null, providerStatus: input.providerStatus ?? null }),
    applyVerifiedTransition: async () => { applyVerifiedTransitionCalled = true; throw new Error("não deveria registrar evento"); },
  };

  await assert.rejects(
    createNativePagBankWalletPayment(
      { orderId: "order-1", walletMethod: "apple_pay", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-pb-0000000001", ...holder },
      deps,
    ),
    (error) => normalizePagBankError(error).category === "timeout",
  );
  assert.equal(applyVerifiedTransitionCalled, false);
});

test("createNativePagBankWalletPayment: recusa (DECLINED) é aplicada como 'failed' pelo mesmo caminho de evento, sem lançar erro", async () => {
  const deps = {
    createAttempt: async (input) => baseAttempt({ idempotencyKey: input.idempotencyKey }),
    createCharge: async () => ({ chargeId: "PB-3", status: "DECLINED", amount: 50, installments: 1 }),
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async (input) => baseAttempt({ status: "pending", version: 1n, providerReference: input.providerReference, providerStatus: input.providerStatus }),
    applyVerifiedTransition: async (input) => verifiedTransition(input, { paymentStatus: "failed" }),
  };

  const result = await createNativePagBankWalletPayment(
    { orderId: "order-1", walletMethod: "google_pay", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-pb-0000000001", ...holder },
    deps,
  );
  assert.equal(result.attempt.status, "failed");
});

// ---------- Verification & webhook (Section 14/15) ----------

test("verifyNativePagBankPaymentStatus nunca aceita o status alegado pelo chamador — sempre reconsulta o provedor", async () => {
  const deps = { getChargeStatus: async () => ({ chargeId: "PB-1", status: "IN_ANALYSIS", amount: 50 }) };
  const result = await verifyNativePagBankPaymentStatus("PB-1", deps);
  assert.equal(result.resultingStatus, "pending");
});

test("applyNativePagBankWebhookNotification: webhook diz pago mas reconsulta ao provedor diz em análise -> permanece pendente", async () => {
  const recorded = [];
  const deps = {
    getChargeStatus: async () => ({ chargeId: "PB-1", status: "IN_ANALYSIS", amount: 50 }),
    applyVerifiedTransition: async (input) => { recorded.push(input); return verifiedTransition(input); },
  };
  await applyNativePagBankWebhookNotification({ attemptId: "attempt-1", providerReference: "PB-1", externalEventId: "evt-ext-1" }, deps);
  assert.equal(recorded[0].resultingStatus, "pending");
});

test("reconcileNativePagBankPendingAttempt usa reconciliation_probe sem external_event_id", async () => {
  const recorded = [];
  const deps = {
    getChargeStatus: async () => ({ chargeId: "PB-1", status: "PAID", amount: 50 }),
    applyVerifiedTransition: async (input) => { recorded.push(input); return verifiedTransition(input, { paymentStatus: "paid" }); },
  };
  await reconcileNativePagBankPendingAttempt({ attemptId: "attempt-1", providerReference: "PB-1" }, deps);
  assert.equal(recorded[0].eventType, "reconciliation_probe");
  assert.equal(recorded[0].externalEventId, null);
  assert.equal(recorded[0].resultingStatus, "paid");
});
