import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveNativeInterPixTxid,
  deriveNativeInterBoletoSeuNumero,
  normalizeInterPixAttemptStatus,
  normalizeInterBoletoAttemptStatus,
  normalizeInterError,
  createNativeInterPixPayment,
  createNativeInterBoletoPayment,
  applyNativeInterWebhookNotification,
  reconcileNativeInterPendingAttempt,
  verifyNativeInterPaymentStatus,
  NativeInterBoletoAmbiguousRetryError,
} from "../services/payments/inter/nativeAdapter.ts";
import { InterPaymentError } from "../services/payments/inter/errors.ts";

// This entire suite mocks every seam that would otherwise touch a real
// provider or a real database (createAttempt/transitionAttempt/applyVerifiedTransition/
// createCharge/getChargeStatus are all injected) — nothing here performs a
// network call or a DB round-trip. Real-Postgres concurrency/idempotency
// proofs for the SAME orchestration live in
// scripts/database/native-inter-payment-concurrency.mjs.

function baseAttempt(overrides = {}) {
  return {
    id: "attempt-1",
    orderId: "order-1",
    provider: "banco_inter",
    method: "pix",
    status: "created",
    amountMinor: 5000n,
    currency: "BRL",
    idempotencyKey: "idem0000000000000000000000000001",
    providerReference: null,
    providerStatus: null,
    failureCode: null,
    failureReason: null,
    version: 0n,
    ...overrides,
  };
}

// ---------- deterministic reference derivation ----------

test("deriveNativeInterPixTxid deriva do idempotency key nativo, não do pedido Woo", () => {
  const txid = deriveNativeInterPixTxid("idem0000000000000000000000000001");
  assert.equal(txid, "idem0000000000000000000000000001");
  assert.match(txid, /^[A-Za-z0-9]{26,35}$/);
});

test("deriveNativeInterPixTxid rejeita chave que não produz txid válido", () => {
  assert.throws(() => deriveNativeInterPixTxid("curta"), InterPaymentError);
});

test("deriveNativeInterBoletoSeuNumero é determinístico e nunca usa id de pedido Woo", () => {
  const a = deriveNativeInterBoletoSeuNumero("idem-a");
  const b = deriveNativeInterBoletoSeuNumero("idem-a");
  const c = deriveNativeInterBoletoSeuNumero("idem-b");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 15);
});

// ---------- status normalization ----------

test("normalizeInterPixAttemptStatus mapeia todos os status Pix conhecidos", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const past = new Date(Date.now() - 3_600_000).toISOString();
  assert.equal(normalizeInterPixAttemptStatus({ status: "CONCLUIDA", expiresAt: future }), "paid");
  assert.equal(normalizeInterPixAttemptStatus({ status: "REMOVIDA_PELO_USUARIO_RECEBEDOR", expiresAt: future }), "cancelled");
  assert.equal(normalizeInterPixAttemptStatus({ status: "REMOVIDA_PELO_PSP", expiresAt: future }), "cancelled");
  assert.equal(normalizeInterPixAttemptStatus({ status: "ATIVA", expiresAt: future }), "pending");
  assert.equal(normalizeInterPixAttemptStatus({ status: "ATIVA", expiresAt: past }), "expired");
});

test("normalizeInterBoletoAttemptStatus mapeia todos os status de boleto conhecidos", () => {
  assert.equal(normalizeInterBoletoAttemptStatus("MARCADO_RECEBIDO"), "paid");
  assert.equal(normalizeInterBoletoAttemptStatus("CANCELADO"), "cancelled");
  assert.equal(normalizeInterBoletoAttemptStatus("EXPIRADO"), "expired");
  assert.equal(normalizeInterBoletoAttemptStatus("FALHA_EMISSAO"), "failed");
  assert.equal(normalizeInterBoletoAttemptStatus("EM_PROCESSAMENTO"), "pending");
  assert.equal(normalizeInterBoletoAttemptStatus("A_RECEBER"), "pending");
  assert.equal(normalizeInterBoletoAttemptStatus("ATRASADO"), "pending");
});

// ---------- error normalization ----------

test("normalizeInterError categoriza timeout, autenticação e erros desconhecidos do provedor", () => {
  assert.equal(normalizeInterError(new InterPaymentError(504, "x", "INTER_TIMEOUT")).category, "timeout");
  assert.equal(normalizeInterError(new InterPaymentError(401, "x", "INTER_AUTH_FAILED")).category, "authentication");
  assert.equal(normalizeInterError(new InterPaymentError(503, "x", "INTER_CONFIG_MISSING")).category, "non_retryable");
  assert.equal(normalizeInterError(new InterPaymentError(404, "x", "INTER_REQUEST_FAILED")).category, "not_found");
  assert.equal(normalizeInterError(new InterPaymentError(422, "x", "INTER_REQUEST_FAILED")).category, "validation");
  assert.equal(normalizeInterError(new InterPaymentError(502, "x", "INTER_REQUEST_FAILED")).category, "provider_unavailable");
  assert.equal(normalizeInterError(new Error("boom")).category, "provider_unavailable");
});

// ---------- PIX creation orchestration ----------

test("createNativeInterPixPayment cria attempt, chama o provedor com txid determinístico e aplica o status inicial", async () => {
  const calls = { createCharge: [], transitionAttempt: [], applyVerifiedTransition: [] };
  const deps = {
    createAttempt: async (input) => baseAttempt({ idempotencyKey: input.idempotencyKey }),
    createCharge: async (input) => {
      calls.createCharge.push(input);
      return { txid: input.txid, status: "ATIVA", qrCodeCopyPaste: "00020126...", qrCodeImageBase64: "base64img", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    },
    getCharge: async () => { throw new Error("não deveria ser chamado nesta orquestração"); },
    getChargeStatus: async () => { throw new Error("não deveria ser chamado nesta orquestração"); },
    transitionAttempt: async (input) => {
      calls.transitionAttempt.push(input);
      return baseAttempt({ status: "pending", version: BigInt(calls.transitionAttempt.length), providerReference: input.providerReference, providerStatus: input.providerStatus });
    },
    applyVerifiedTransition: async (input) => {
      calls.applyVerifiedTransition.push(input);
      return { paymentAttemptId: input.attemptId, paymentStatus: input.resultingStatus ?? null, paymentVersion: 1n, paymentEventId: "evt-1", paymentEventProcessingResult: "applied", orderId: "order-1", orderStatus: "pending", orderTransitioned: false, inventoryConfirmedCount: 0, inventoryReleasedCount: 0 };
    },
  };

  const result = await createNativeInterPixPayment(
    { orderId: "order-1", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem0000000000000000000000000001", payerDocument: "52998224725", payerName: "Maria Silva", description: "Pedido nativo" },
    deps,
  );

  assert.equal(calls.createCharge[0].txid, "idem0000000000000000000000000001");
  assert.equal(calls.createCharge[0].amount, 50);
  // First transition call is the concurrency CLAIM (no provider reference
  // yet — the provider hasn't been called at this point); the second
  // attaches the reference obtained from the provider call in between.
  assert.equal(calls.transitionAttempt.length, 2);
  assert.equal(calls.transitionAttempt[0].expected, "created");
  assert.equal(calls.transitionAttempt[0].target, "pending");
  assert.equal(calls.transitionAttempt[0].providerReference, undefined);
  assert.equal(calls.transitionAttempt[1].expected, "pending");
  assert.equal(calls.transitionAttempt[1].target, "pending");
  assert.equal(calls.transitionAttempt[1].providerReference, "idem0000000000000000000000000001");
  assert.equal(calls.applyVerifiedTransition[0].resultingStatus, "pending");
  assert.equal(result.attempt.status, "pending");
  assert.ok(result.charge);
});

test("createNativeInterPixPayment: ao perder a corrida do claim, retorna quieto sem chamar o provedor", async () => {
  let providerCalled = false;
  const deps = {
    createAttempt: async (input) => baseAttempt({ idempotencyKey: input.idempotencyKey }),
    createCharge: async () => { providerCalled = true; throw new Error("não deveria ser chamado"); },
    getCharge: async () => { throw new Error("unused"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async () => { throw new Error("stale_payment_attempt_transition"); },
    applyVerifiedTransition: async () => { throw new Error("não deveria registrar evento"); },
  };

  const result = await createNativeInterPixPayment(
    { orderId: "order-1", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem0000000000000000000000000001", payerDocument: "52998224725", payerName: "Maria Silva", description: "x" },
    deps,
  );
  assert.equal(providerCalled, false);
  assert.equal(result.charge, null);
});

test("createNativeInterPixPayment é retry-safe: attempt além de 'created' nunca chama o provedor de novo", async () => {
  let providerCalled = false;
  const deps = {
    createAttempt: async () => baseAttempt({ status: "pending", providerReference: "idem0000000000000000000000000001", providerStatus: "ATIVA" }),
    createCharge: async () => { providerCalled = true; throw new Error("não deveria criar de novo"); },
    getCharge: async () => { throw new Error("unused"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async () => { throw new Error("não deveria transicionar de novo"); },
    applyVerifiedTransition: async () => { throw new Error("não deveria registrar evento de novo"); },
  };

  const result = await createNativeInterPixPayment(
    { orderId: "order-1", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem0000000000000000000000000001", payerDocument: "52998224725", payerName: "Maria Silva", description: "Pedido nativo" },
    deps,
  );

  assert.equal(providerCalled, false);
  assert.equal(result.charge, null);
  assert.equal(result.attempt.status, "pending");
});

test("createNativeInterPixPayment: cobrança já nascida CONCLUIDA aplica 'paid' pelo mesmo caminho de evento", async () => {
  const deps = {
    createAttempt: async (input) => baseAttempt({ idempotencyKey: input.idempotencyKey }),
    createCharge: async (input) => ({ txid: input.txid, status: "CONCLUIDA", qrCodeCopyPaste: "x", qrCodeImageBase64: "y", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    getCharge: async () => { throw new Error("unused"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async (input) => baseAttempt({ status: "pending", version: 1n, providerReference: input.providerReference, providerStatus: input.providerStatus }),
    applyVerifiedTransition: async (input) => ({ paymentAttemptId: input.attemptId, paymentStatus: "paid", paymentVersion: 1n, paymentEventId: "evt-1", paymentEventProcessingResult: "applied", orderId: "order-1", orderStatus: "confirmed", orderTransitioned: true, inventoryConfirmedCount: 1, inventoryReleasedCount: 0 }),
  };

  const result = await createNativeInterPixPayment(
    { orderId: "order-1", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem0000000000000000000000000001", payerDocument: "52998224725", payerName: "Maria Silva", description: "x" },
    deps,
  );
  assert.equal(result.attempt.status, "paid");
});

test("createNativeInterPixPayment propaga timeout do provedor após o claim, sem registrar evento", async () => {
  let applyVerifiedTransitionCalled = false;
  const deps = {
    createAttempt: async (input) => baseAttempt({ idempotencyKey: input.idempotencyKey }),
    createCharge: async () => { throw new InterPaymentError(504, "timeout", "INTER_TIMEOUT"); },
    getCharge: async () => { throw new Error("unused"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    // Only the CLAIM transition (created -> pending, no reference) happens
    // before the provider call — it must succeed so the timeout below is
    // attributable purely to the provider call itself, not the claim.
    transitionAttempt: async (input) => baseAttempt({ status: "pending", version: 1n, providerReference: input.providerReference ?? null, providerStatus: input.providerStatus ?? null }),
    applyVerifiedTransition: async () => { applyVerifiedTransitionCalled = true; throw new Error("não deveria registrar evento"); },
  };

  await assert.rejects(
    createNativeInterPixPayment(
      { orderId: "order-1", amountMinor: 5000n, currency: "BRL", idempotencyKey: "idem0000000000000000000000000001", payerDocument: "52998224725", payerName: "Maria Silva", description: "x" },
      deps,
    ),
    (error) => normalizeInterError(error).category === "timeout",
  );
  assert.equal(applyVerifiedTransitionCalled, false);
});

// ---------- Boleto creation orchestration ----------

const jundiaiAddress = { firstName: "Maria", lastName: "Silva", address1: "Rua A, 1", city: "Jundiaí", state: "SP", postcode: "13201000", country: "BR" };

test("createNativeInterBoletoPayment cria attempt, deriva seuNumero e não depende de id de pedido Woo", async () => {
  const calls = { createCharge: [], transitionAttempt: [] };
  const deps = {
    createAttempt: async (input) => baseAttempt({ method: "boleto", idempotencyKey: input.idempotencyKey }),
    createCharge: async (input) => { calls.createCharge.push(input); return { requestCode: "REQ-1", status: "EM_PROCESSAMENTO", digitableLine: "", barcode: "", dueDate: "2026-09-21" }; },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async (input) => { calls.transitionAttempt.push(input); return baseAttempt({ method: "boleto", idempotencyKey: "idem-boleto-native", status: "pending", version: BigInt(calls.transitionAttempt.length), providerReference: input.providerReference, providerStatus: input.providerStatus }); },
    applyVerifiedTransition: async (input) => ({ paymentAttemptId: input.attemptId, paymentStatus: "pending", paymentVersion: 1n, paymentEventId: "evt-1", paymentEventProcessingResult: "applied", orderId: "order-1", orderStatus: "pending", orderTransitioned: false, inventoryConfirmedCount: 0, inventoryReleasedCount: 0 }),
  };

  const result = await createNativeInterBoletoPayment(
    { orderId: "order-1", amountMinor: 12345n, currency: "BRL", idempotencyKey: "idem-boleto-native", payerDocument: "52998224725", payerName: "Maria Silva", billingAddress: jundiaiAddress },
    deps,
  );

  assert.equal(calls.transitionAttempt.length, 2);
  assert.equal(calls.transitionAttempt[0].providerReference, undefined);
  assert.equal(calls.createCharge[0].seuNumero, deriveNativeInterBoletoSeuNumero("idem-boleto-native"));
  assert.doesNotMatch(calls.createCharge[0].seuNumero, /order-1/);
  assert.equal(result.attempt.status, "pending");
});

test("createNativeInterBoletoPayment: ao perder a corrida do claim, retorna quieto sem chamar o provedor (não idempotente)", async () => {
  let providerCalled = false;
  const deps = {
    createAttempt: async (input) => baseAttempt({ method: "boleto", idempotencyKey: input.idempotencyKey }),
    createCharge: async () => { providerCalled = true; throw new Error("não deveria ser chamado"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async () => { throw new Error("stale_payment_attempt_transition"); },
    applyVerifiedTransition: async () => { throw new Error("unused"); },
  };

  const result = await createNativeInterBoletoPayment(
    { orderId: "order-1", amountMinor: 12345n, currency: "BRL", idempotencyKey: "idem-x", payerDocument: "52998224725", payerName: "Maria Silva", billingAddress: jundiaiAddress },
    deps,
  );
  assert.equal(providerCalled, false);
  assert.equal(result.charge, null);
});

test("createNativeInterBoletoPayment recusa retomada ambígua (pending, sem provider_reference) em vez de arriscar cobrança duplicada", async () => {
  const deps = {
    createAttempt: async () => baseAttempt({ method: "boleto", status: "pending", providerReference: null }),
    createCharge: async () => { throw new Error("não deveria criar de novo"); },
    getChargeStatus: async () => { throw new Error("unused"); },
    transitionAttempt: async () => { throw new Error("unused"); },
    applyVerifiedTransition: async () => { throw new Error("unused"); },
  };

  await assert.rejects(
    createNativeInterBoletoPayment(
      { orderId: "order-1", amountMinor: 12345n, currency: "BRL", idempotencyKey: "idem-x", payerDocument: "52998224725", payerName: "Maria Silva", billingAddress: jundiaiAddress },
      deps,
    ),
    NativeInterBoletoAmbiguousRetryError,
  );
});

// ---------- Verification & webhook (Section 10/18) ----------

test("verifyNativeInterPaymentStatus nunca aceita o status alegado pelo chamador — sempre reconsulta o provedor", async () => {
  const deps = { getPixStatus: async (txid) => ({ txid, status: "ATIVA", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }), getBoletoStatus: async () => { throw new Error("unused"); } };
  const result = await verifyNativeInterPaymentStatus("pix", "txid-1", deps);
  assert.equal(result.resultingStatus, "pending");
});

test("applyNativeInterWebhookNotification ignora o status do corpo do webhook e usa somente a reconsulta ao provedor", async () => {
  const recorded = [];
  const deps = {
    getPixStatus: async () => ({ status: "ATIVA", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }), // provider says PENDING
    getBoletoStatus: async () => { throw new Error("unused"); },
    applyVerifiedTransition: async (input) => { recorded.push(input); return { paymentAttemptId: input.attemptId, paymentStatus: input.resultingStatus, paymentVersion: 1n, paymentEventId: "evt-1", paymentEventProcessingResult: "applied", orderId: "order-1", orderStatus: "pending", orderTransitioned: false, inventoryConfirmedCount: 0, inventoryReleasedCount: 0 }; },
  };

  // The webhook "claims" nothing explicit here (there is no status field
  // accepted at all) -- this test's whole point is that even though a real
  // Inter webhook body carries no reliable status, if it DID, this function
  // has no parameter through which a caller could inject "paid" and have it
  // trusted. The resultingStatus recorded is only ever what the provider
  // query itself said.
  await applyNativeInterWebhookNotification({ attemptId: "attempt-1", method: "pix", providerReference: "txid-1", externalEventId: "evt-ext-1" }, deps);
  assert.equal(recorded[0].resultingStatus, "pending");
});

test("reconciliação: webhook diz pago mas reconsulta ao provedor diz pendente -> permanece pendente", async () => {
  const recorded = [];
  const deps = {
    getPixStatus: async () => { throw new Error("unused"); },
    getBoletoStatus: async () => ({ requestCode: "REQ-1", status: "A_RECEBER", digitableLine: "", barcode: "", dueDate: "2026-09-21" }),
    applyVerifiedTransition: async (input) => { recorded.push(input); return { paymentAttemptId: input.attemptId, paymentStatus: input.resultingStatus, paymentVersion: 1n, paymentEventId: "evt-2", paymentEventProcessingResult: "applied", orderId: "order-1", orderStatus: "pending", orderTransitioned: false, inventoryConfirmedCount: 0, inventoryReleasedCount: 0 }; },
  };
  await reconcileNativeInterPendingAttempt({ attemptId: "attempt-1", method: "boleto", providerReference: "REQ-1" }, deps);
  assert.equal(recorded[0].resultingStatus, "pending");
  assert.equal(recorded[0].eventType, "reconciliation_probe");
  assert.equal(recorded[0].externalEventId, null);
});
