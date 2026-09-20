import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveNativeMercadoPagoIdempotencyKey,
  normalizeMercadoPagoAttemptStatus,
  normalizeMercadoPagoError,
  createNativeMercadoPagoCardPayment,
  applyNativeMercadoPagoWebhookNotification,
  reconcileNativeMercadoPagoPendingAttempt,
  verifyNativeMercadoPagoPaymentStatus,
} from "../services/payments/mercadopago/nativeAdapter.ts";
import { MercadoPagoPaymentError } from "../services/payments/mercadopago/errors.ts";

// Every provider/DB seam is mocked here — no network call, no DB round
// trip. Real-Postgres concurrency proofs for the SAME orchestration live in
// scripts/database/native-mercadopago-payment-concurrency.mjs.

function baseAttempt(overrides = {}) {
  return {
    id: "attempt-1",
    orderId: "order-1",
    provider: "mercado_pago",
    method: "credit_card",
    status: "created",
    amountMinor: 5000n,
    currency: "BRL",
    idempotencyKey: "idem-mp-0000000001",
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

const holder = { cardToken: "tok_synthetic_abc123", installments: 3, paymentMethodId: "master", holderDocument: "52998224725", holderName: "Maria Silva", holderEmail: "maria@example.invalid" };

// ---------- deterministic idempotency key ----------

test("deriveNativeMercadoPagoIdempotencyKey reaproveita a chave nativa do ledger sem transformação Woo", () => {
  assert.equal(deriveNativeMercadoPagoIdempotencyKey("idem-mp-0000000001"), "idem-mp-0000000001");
});

test("deriveNativeMercadoPagoIdempotencyKey rejeita chave vazia", () => {
  assert.throws(() => deriveNativeMercadoPagoIdempotencyKey("   "), MercadoPagoPaymentError);
});

// ---------- status normalization ----------

test("normalizeMercadoPagoAttemptStatus mapeia todos os status reais conhecidos", () => {
  assert.equal(normalizeMercadoPagoAttemptStatus("approved"), "paid");
  assert.equal(normalizeMercadoPagoAttemptStatus("authorized"), "authorized");
  assert.equal(normalizeMercadoPagoAttemptStatus("in_process"), "pending");
  assert.equal(normalizeMercadoPagoAttemptStatus("pending"), "pending");
  assert.equal(normalizeMercadoPagoAttemptStatus("rejected"), "failed");
  assert.equal(normalizeMercadoPagoAttemptStatus("cancelled"), "cancelled");
  assert.equal(normalizeMercadoPagoAttemptStatus("refunded"), "refunded");
  assert.equal(normalizeMercadoPagoAttemptStatus("charged_back"), "refunded");
});

// ---------- error normalization ----------

test("normalizeMercadoPagoError categoriza timeout/indisponibilidade, autenticação e erros de validação", () => {
  assert.equal(normalizeMercadoPagoError(new MercadoPagoPaymentError(502, "x", "MERCADOPAGO_API_UNAVAILABLE")).category, "timeout");
  assert.equal(normalizeMercadoPagoError(new MercadoPagoPaymentError(503, "x", "MERCADOPAGO_CONFIG_MISSING")).category, "non_retryable");
  assert.equal(normalizeMercadoPagoError(new MercadoPagoPaymentError(401, "x", "MERCADOPAGO_API_ERROR")).category, "authentication");
  assert.equal(normalizeMercadoPagoError(new MercadoPagoPaymentError(404, "x", "MERCADOPAGO_API_ERROR")).category, "not_found");
  assert.equal(normalizeMercadoPagoError(new MercadoPagoPaymentError(422, "x", "MERCADOPAGO_API_ERROR")).category, "validation");
  assert.equal(normalizeMercadoPagoError(new MercadoPagoPaymentError(500, "x", "MERCADOPAGO_API_ERROR")).category, "provider_unavailable");
  assert.equal(normalizeMercadoPagoError(new Error("boom")).category, "provider_unavailable");
});

// ---------- card creation orchestration ----------

test("createNativeMercadoPagoCardPayment cria attempt, chama o provedor com a idempotency key nativa e nunca com id de pedido Woo", async () => {
  const calls = { createCharge: [], transitionAttempt: [], applyVerifiedTransition: [] };
  const deps = {
    createAttempt: async (input) => baseAttempt({ idempotencyKey: input.idempotencyKey }),
    createCharge: async (input, idempotencyKey) => {
      calls.createCharge.push({ input, idempotencyKey });
      return { chargeId: "MP-1", status: "approved", amount: 50, brand: "master", lastDigits: "1234", installments: 3 };
    },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async (input) => { calls.transitionAttempt.push(input); return baseAttempt({ idempotencyKey: "idem-mp-0000000001", status: "pending", version: BigInt(calls.transitionAttempt.length), providerReference: input.providerReference, providerStatus: input.providerStatus }); },
    applyVerifiedTransition: async (input) => { calls.applyVerifiedTransition.push(input); return verifiedTransition(input, { paymentStatus: "paid" }); },
  };

  const result = await createNativeMercadoPagoCardPayment(
    { orderId: "order-1", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-mp-0000000001", ...holder },
    deps,
  );

  assert.equal(calls.createCharge[0].idempotencyKey, "idem-mp-0000000001");
  assert.equal(calls.createCharge[0].input.referenceId, "order-1");
  assert.doesNotMatch(JSON.stringify(calls.createCharge[0]), /Woo|wc\/v3/i);
  assert.equal(calls.transitionAttempt.length, 2);
  assert.equal(calls.transitionAttempt[0].providerReference, undefined);
  assert.equal(calls.transitionAttempt[1].providerReference, "MP-1");
  assert.equal(calls.applyVerifiedTransition[0].resultingStatus, "paid");
  assert.equal(result.attempt.status, "paid");
  assert.ok(result.charge);
});

test("createNativeMercadoPagoCardPayment é retry-safe: attempt com referência já anexada nunca chama o provedor de novo", async () => {
  let providerCalled = false;
  const deps = {
    createAttempt: async () => baseAttempt({ status: "pending", providerReference: "MP-1", providerStatus: "approved" }),
    createCharge: async () => { providerCalled = true; throw new Error("não deveria ser chamado"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async () => { throw new Error("não deveria transicionar"); },
    applyVerifiedTransition: async () => { throw new Error("não deveria registrar evento"); },
  };

  const result = await createNativeMercadoPagoCardPayment(
    { orderId: "order-1", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-mp-0000000001", ...holder },
    deps,
  );
  assert.equal(providerCalled, false);
  assert.equal(result.charge, null);
});

test("createNativeMercadoPagoCardPayment: ao perder a corrida do claim, retorna quieto sem chamar o provedor", async () => {
  let providerCalled = false;
  const deps = {
    createAttempt: async (input) => baseAttempt({ idempotencyKey: input.idempotencyKey }),
    createCharge: async () => { providerCalled = true; throw new Error("não deveria ser chamado"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async () => { throw new Error("stale_payment_attempt_transition"); },
    applyVerifiedTransition: async () => { throw new Error("não deveria registrar evento"); },
  };

  const result = await createNativeMercadoPagoCardPayment(
    { orderId: "order-1", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-mp-0000000001", ...holder },
    deps,
  );
  assert.equal(providerCalled, false);
  assert.equal(result.charge, null);
});

test("createNativeMercadoPagoCardPayment: retomar de 'pending' sem referência (timeout ambíguo) é permitido e chama o provedor de novo com a MESMA idempotency key", async () => {
  const calls = { createCharge: [] };
  const deps = {
    createAttempt: async () => baseAttempt({ status: "pending", providerReference: null, version: 1n }),
    createCharge: async (input, idempotencyKey) => { calls.createCharge.push(idempotencyKey); return { chargeId: "MP-2", status: "rejected", amount: 50, installments: 3 }; },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async (input) => baseAttempt({ status: "pending", version: 2n, providerReference: input.providerReference, providerStatus: input.providerStatus }),
    applyVerifiedTransition: async (input) => verifiedTransition(input, { paymentStatus: "failed" }),
  };

  const result = await createNativeMercadoPagoCardPayment(
    { orderId: "order-1", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-mp-0000000001", ...holder },
    deps,
  );
  assert.equal(calls.createCharge[0], "idem-mp-0000000001");
  assert.equal(result.attempt.status, "failed");
});

test("createNativeMercadoPagoCardPayment: recusa do cartão (rejected) é aplicada como 'failed' pelo mesmo caminho de evento, sem lançar erro", async () => {
  const deps = {
    createAttempt: async (input) => baseAttempt({ idempotencyKey: input.idempotencyKey }),
    createCharge: async () => ({ chargeId: "MP-3", status: "rejected", amount: 50, installments: 1 }),
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async (input) => baseAttempt({ status: "pending", version: 1n, providerReference: input.providerReference, providerStatus: input.providerStatus }),
    applyVerifiedTransition: async (input) => verifiedTransition(input, { paymentStatus: "failed" }),
  };

  const result = await createNativeMercadoPagoCardPayment(
    { orderId: "order-1", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-mp-0000000001", ...holder },
    deps,
  );
  assert.equal(result.attempt.status, "failed");
});

test("createNativeMercadoPagoCardPayment propaga timeout do provedor após o claim, sem registrar evento", async () => {
  let applyVerifiedTransitionCalled = false;
  const deps = {
    createAttempt: async (input) => baseAttempt({ idempotencyKey: input.idempotencyKey }),
    createCharge: async () => { throw new MercadoPagoPaymentError(502, "timeout", "MERCADOPAGO_API_UNAVAILABLE"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async (input) => baseAttempt({ status: "pending", version: 1n, providerReference: input.providerReference ?? null, providerStatus: input.providerStatus ?? null }),
    applyVerifiedTransition: async () => { applyVerifiedTransitionCalled = true; throw new Error("não deveria registrar evento"); },
  };

  await assert.rejects(
    createNativeMercadoPagoCardPayment(
      { orderId: "order-1", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem-mp-0000000001", ...holder },
      deps,
    ),
    (error) => normalizeMercadoPagoError(error).category === "timeout",
  );
  assert.equal(applyVerifiedTransitionCalled, false);
});

// ---------- Verification & webhook (Section 13/14) ----------

test("verifyNativeMercadoPagoPaymentStatus nunca aceita o status alegado pelo chamador — sempre reconsulta o provedor", async () => {
  const deps = { getChargeStatus: async () => ({ chargeId: "MP-1", status: "in_process", amount: 50 }) };
  const result = await verifyNativeMercadoPagoPaymentStatus("MP-1", deps);
  assert.equal(result.resultingStatus, "pending");
});

test("applyNativeMercadoPagoWebhookNotification: webhook diz pago mas reconsulta ao provedor diz pendente -> permanece pendente", async () => {
  const recorded = [];
  const deps = {
    getChargeStatus: async () => ({ chargeId: "MP-1", status: "in_process", amount: 50 }),
    applyVerifiedTransition: async (input) => { recorded.push(input); return verifiedTransition(input); },
  };
  await applyNativeMercadoPagoWebhookNotification({ attemptId: "attempt-1", providerReference: "MP-1", externalEventId: "evt-ext-1" }, deps);
  assert.equal(recorded[0].resultingStatus, "pending");
});

test("reconcileNativeMercadoPagoPendingAttempt usa reconciliation_probe sem external_event_id", async () => {
  const recorded = [];
  const deps = {
    getChargeStatus: async () => ({ chargeId: "MP-1", status: "approved", amount: 50 }),
    applyVerifiedTransition: async (input) => { recorded.push(input); return verifiedTransition(input, { paymentStatus: "paid" }); },
  };
  await reconcileNativeMercadoPagoPendingAttempt({ attemptId: "attempt-1", providerReference: "MP-1" }, deps);
  assert.equal(recorded[0].eventType, "reconciliation_probe");
  assert.equal(recorded[0].externalEventId, null);
  assert.equal(recorded[0].resultingStatus, "paid");
});
