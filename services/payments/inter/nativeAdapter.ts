import "server-only";

import { createHash } from "node:crypto";
import type { CheckoutStoreAddress } from "@/types/checkout";
import {
  applyVerifiedPaymentTransition,
  createNativePaymentAttempt,
  transitionNativePaymentAttempt,
  type NativePaymentAttempt,
  type PaymentAttemptStatus,
} from "@/lib/db/nativePayment";
import {
  createPixCharge,
  getPixCharge,
  getPixChargeStatus,
  isPixChargeExpired,
  type PixCharge,
  type PixChargeStatus,
} from "./pix";
import {
  createBoletoCharge,
  getBoletoChargeStatus,
  getBoletoPdfBase64,
  type BoletoCharge,
  type BoletoChargeStatus,
} from "./boleto";
import { InterPaymentError } from "./errors";

// B.3-E — NATIVE Banco Inter reanchoring. This module is the ONLY thing new
// in this round that talks to both the ledger (lib/db/nativePayment.ts) and
// the existing Inter provider logic (./pix.ts, ./boleto.ts). Everything it
// calls in ./pix.ts and ./boleto.ts is REUSED PROVIDER_LOGIC, unchanged: the
// request builders, status parsers, QR generation, boleto polling. What this
// module replaces is WOO_ANCHORING — services/payments/gateway.ts and
// services/woocommerce/orders.ts's createPendingOrder/attachPaymentReference/
// markOrderAsPaid, which the legacy checkout route (app/api/checkout/payment/
// route.ts) still uses and which this module never touches.
//
// This file makes NO real provider calls itself, and does not decide WHEN a
// PIX/boleto is created — that orchestration (checkout flow) does not exist
// yet, matching Section 26: INTER_NATIVE_LIVE=NO regardless of what passes
// here.

// ---------------------------------------------------------------------------
// Deterministic, native-identity-derived provider references
// ---------------------------------------------------------------------------

// The legacy path already derives its Pix txid from a caller-supplied
// idempotency key, not from the Woo order id (app/api/checkout/payment/
// route.ts: `txid: input.idempotencyKey.replace(/-/g, "")`) — that part was
// never Woo-anchored to begin with. The native path reuses the exact same
// transformation, but the idempotency key it feeds in is the NATIVE
// payment_attempt's own `idempotency_key` column (unique per (provider,
// key) — see the ledger migration), never a Woo order id. Same derivation,
// different, Woo-free source of truth.
export function deriveNativeInterPixTxid(paymentAttemptIdempotencyKey: string): string {
  const txid = paymentAttemptIdempotencyKey.replace(/[^A-Za-z0-9]/g, "");
  if (txid.length < 26 || txid.length > 35) {
    throw new InterPaymentError(
      500,
      "Idempotency key não produz um txid Pix válido (26-35 caracteres alfanuméricos)",
      "INTER_NATIVE_TXID_DERIVATION_INVALID",
    );
  }
  return txid;
}

// Boleto's "seu número" has no txid-like format requirement from Inter (it
// is merchant-defined free text), but it must still be deterministic and
// Woo-free. Derived by hashing the payment attempt's own idempotency key —
// NOT `String(order.id)`, which is what the legacy path uses today
// (services/woocommerce/orders.ts is never involved in this derivation).
export function deriveNativeInterBoletoSeuNumero(paymentAttemptIdempotencyKey: string): string {
  return createHash("sha256").update(paymentAttemptIdempotencyKey, "utf8").digest("hex").slice(0, 15);
}

// ---------------------------------------------------------------------------
// Provider status -> ledger status normalization
// ---------------------------------------------------------------------------

// The Pix API (Bacen standard) has no "expired" status of its own — see
// ./pix.ts's isPixChargeExpired for why that determination is ours to make,
// reused here unchanged.
export function normalizeInterPixAttemptStatus(
  charge: Pick<PixCharge, "status" | "expiresAt">,
): PaymentAttemptStatus {
  if (charge.status === "CONCLUIDA") return "paid";
  if (charge.status === "REMOVIDA_PELO_USUARIO_RECEBEDOR" || charge.status === "REMOVIDA_PELO_PSP") {
    return "cancelled";
  }
  if (isPixChargeExpired(charge)) return "expired";
  return "pending";
}

export function normalizeInterBoletoAttemptStatus(status: BoletoChargeStatus): PaymentAttemptStatus {
  if (status === "MARCADO_RECEBIDO") return "paid";
  if (status === "CANCELADO") return "cancelled";
  if (status === "EXPIRADO") return "expired";
  if (status === "FALHA_EMISSAO") return "failed";
  return "pending"; // EM_PROCESSAMENTO, A_RECEBER, ATRASADO
}

// ---------------------------------------------------------------------------
// Error normalization (Section 16) — internal categories only, never the
// provider's raw message persisted anywhere durable.
// ---------------------------------------------------------------------------

export type NativeInterErrorCategory =
  | "retryable"
  | "non_retryable"
  | "authentication"
  | "validation"
  | "provider_unavailable"
  | "timeout"
  | "conflict"
  | "not_found";

export interface NormalizedInterError {
  category: NativeInterErrorCategory;
  httpStatus: number;
}

const NON_RETRYABLE_CODES = new Set([
  "INTER_CONFIG_MISSING",
  "INTER_PIX_UNKNOWN_STATUS",
  "INTER_BOLETO_UNKNOWN_STATUS",
  "INTER_BOLETO_INVALID_RESPONSE",
  "INTER_PIX_MISSING_COPY_PASTE_CODE",
  "INTER_BOLETO_PDF_UNAVAILABLE",
  "INTER_NATIVE_TXID_DERIVATION_INVALID",
]);

export function normalizeInterError(error: unknown): NormalizedInterError {
  if (error instanceof InterPaymentError) {
    if (error.code === "INTER_TIMEOUT") return { category: "timeout", httpStatus: error.status };
    if (error.code === "INTER_AUTH_FAILED") return { category: "authentication", httpStatus: error.status };
    if (NON_RETRYABLE_CODES.has(error.code)) return { category: "non_retryable", httpStatus: error.status };
    if (error.status === 404) return { category: "not_found", httpStatus: error.status };
    if (error.status === 409) return { category: "conflict", httpStatus: error.status };
    if (error.status >= 400 && error.status < 500) return { category: "validation", httpStatus: error.status };
    return { category: "provider_unavailable", httpStatus: error.status };
  }
  return { category: "provider_unavailable", httpStatus: 502 };
}

// ---------------------------------------------------------------------------
// PIX — native creation
// ---------------------------------------------------------------------------

export interface CreateNativeInterPixInput {
  orderId: string;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  payerDocument: string;
  payerName: string;
  description: string;
}

export interface NativeInterPixResult {
  attempt: NativePaymentAttempt;
  /** Present only when this call actually talked to the provider (fresh
   * creation or a "created"-stuck retry) — a pure ledger-idempotent replay
   * of an already-pending/terminal attempt does not re-fetch it. Callers
   * needing the QR code for an existing attempt should call
   * getNativeInterPixPresentation separately (Section 9: presentation data
   * is never persisted, always re-fetched from the provider on demand). */
  charge: PixCharge | null;
}

// Injectable seams for tests: never call the real provider or the real
// database from a unit test. Both default to the real implementations.
export interface NativeInterPixDeps {
  createCharge: typeof createPixCharge;
  getCharge: typeof getPixCharge;
  getChargeStatus: typeof getPixChargeStatus;
  createAttempt: typeof createNativePaymentAttempt;
  transitionAttempt: typeof transitionNativePaymentAttempt;
  applyVerifiedTransition: typeof applyVerifiedPaymentTransition;
}

const defaultPixDeps: NativeInterPixDeps = {
  createCharge: createPixCharge,
  getCharge: getPixCharge,
  getChargeStatus: getPixChargeStatus,
  createAttempt: createNativePaymentAttempt,
  transitionAttempt: transitionNativePaymentAttempt,
  applyVerifiedTransition: applyVerifiedPaymentTransition,
};

// The ledger's own optimistic-concurrency check (version mismatch) raises
// this exact message (see supabase/migrations/20260920000000_..._foundation.
// sql's transition_native_payment_attempt) — matched the same way the
// concurrency harness in scripts/database/native-payment-ledger-concurrency.
// mjs already does when it calls the SQL function directly via the raw
// `postgres` package. Reached through lib/db/nativePayment.ts (drizzle-orm),
// as every real call site in this file is, the thrown error is a
// DrizzleQueryError whose OWN .message is always the generic "Failed
// query: ..." text — the actual Postgres error (and its real message) is
// nested in .cause instead (drizzle-orm/errors.js's own DrizzleQueryError
// constructor). Found here because this claim-gate's race-loss path had
// never been exercised through the real drizzle-wrapped path under genuine
// concurrency before B.3-I's checkout-service harness (every earlier
// adapter-round harness called the SQL functions directly, bypassing
// drizzle entirely) — checking only error.message silently never matched,
// so a race loser would previously propagate this as an unhandled
// rejection instead of returning quietly.
function isStalePaymentAttemptTransition(error: unknown): boolean {
  const pattern = /stale_payment_attempt_transition/;
  if (error instanceof Error && pattern.test(error.message)) return true;
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof Error && pattern.test(cause.message);
}

// Idempotent, retry-safe: the SAME (orderId, idempotencyKey) always
// converges on the SAME logical payment_attempt and the SAME Pix txid.
// Never creates a second logical charge for a retried call.
//
// Concurrency note: two truly concurrent callers with the same idempotency
// key both get the SAME "created" attempt back from createAttempt (the
// ledger's own insert-or-fetch idempotency). Only ONE of them may win the
// claim below (created -> pending, no reference yet) before either calls
// the provider — the loser returns quietly with charge=null instead of
// racing the winner into a second provider call. For Pix specifically a
// second provider call would actually be harmless (creation is a PUT to a
// caller-chosen /pix/v2/cob/{txid} path — idempotent at Inter itself), but
// the claim gate is still applied uniformly here rather than special-cased,
// so this function's safety does not silently depend on that provider
// detail (see createNativeInterBoletoPayment, where the equivalent gate is
// load-bearing because Boleto's POST is NOT idempotent at the provider).
export async function createNativeInterPixPayment(
  input: CreateNativeInterPixInput,
  deps: NativeInterPixDeps = defaultPixDeps,
): Promise<NativeInterPixResult> {
  const attempt = await deps.createAttempt({
    orderId: input.orderId,
    provider: "banco_inter",
    method: "pix",
    amountMinor: input.amountMinor,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
  });

  let claimed = attempt;
  if (attempt.status === "created") {
    try {
      claimed = await deps.transitionAttempt({
        attemptId: attempt.id,
        expected: "created",
        target: "pending",
        expectedVersion: attempt.version,
      });
    } catch (error) {
      if (isStalePaymentAttemptTransition(error)) return { attempt, charge: null };
      throw error;
    }
  } else if (!(attempt.status === "pending" && !attempt.providerReference)) {
    // Already has a provider reference, or already terminal — pure retry,
    // never talk to the provider again.
    return { attempt, charge: null };
  }

  const txid = deriveNativeInterPixTxid(claimed.idempotencyKey);
  const charge = await deps.createCharge({
    txid,
    amount: Number(input.amountMinor) / 100,
    payerDocument: input.payerDocument,
    payerName: input.payerName,
    description: input.description,
  });

  const withReference = await deps.transitionAttempt({
    attemptId: claimed.id,
    expected: "pending",
    target: "pending",
    expectedVersion: claimed.version,
    providerReference: charge.txid,
    providerStatus: charge.status,
  });

  // The initial charge may already be in a terminal state on the VERY first
  // response (e.g. a provider-side rule voids it instantly) — applying it
  // through the same event path used for every later status observation
  // keeps this a single, uniform mechanism instead of a special case, and
  // never bypasses the ledger's own transition-validity rules.
  const initialStatus = normalizeInterPixAttemptStatus(charge);
  const withInitialEvent = await deps.applyVerifiedTransition({
    attemptId: withReference.id,
    eventType: "status_observed",
    observedStatus: charge.status,
    resultingStatus: initialStatus,
  });

  return {
    attempt: { ...withReference, status: withInitialEvent.paymentStatus ?? withReference.status },
    charge,
  };
}

// Presentation data (QR code image/copy-paste) is NEVER persisted in the
// ledger (Section 9) — it is always re-derived live from the provider using
// the durable provider_reference (txid) already stored on the attempt. This
// mirrors the legacy status route (app/api/checkout/payment/status/route.ts),
// which re-fetches on every poll instead of caching the QR anywhere.
export async function getNativeInterPixPresentation(
  attempt: Pick<NativePaymentAttempt, "providerReference">,
  deps: Pick<NativeInterPixDeps, "getCharge"> = defaultPixDeps,
): Promise<PixCharge> {
  if (!attempt.providerReference) {
    throw new InterPaymentError(409, "Tentativa de pagamento Pix ainda não tem referência do provedor", "INTER_NATIVE_NO_PROVIDER_REFERENCE");
  }
  return deps.getCharge(attempt.providerReference);
}

// ---------------------------------------------------------------------------
// Boleto — native creation
// ---------------------------------------------------------------------------

export interface CreateNativeInterBoletoInput {
  orderId: string;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  payerDocument: string;
  payerName: string;
  billingAddress: CheckoutStoreAddress;
}

export interface NativeInterBoletoResult {
  attempt: NativePaymentAttempt;
  charge: BoletoCharge | null;
}

export interface NativeInterBoletoDeps {
  createCharge: typeof createBoletoCharge;
  getChargeStatus: typeof getBoletoChargeStatus;
  createAttempt: typeof createNativePaymentAttempt;
  transitionAttempt: typeof transitionNativePaymentAttempt;
  applyVerifiedTransition: typeof applyVerifiedPaymentTransition;
}

const defaultBoletoDeps: NativeInterBoletoDeps = {
  createCharge: createBoletoCharge,
  getChargeStatus: getBoletoChargeStatus,
  createAttempt: createNativePaymentAttempt,
  transitionAttempt: transitionNativePaymentAttempt,
  applyVerifiedTransition: applyVerifiedPaymentTransition,
};

// IMPORTANT ASYMMETRY WITH PIX (documented, not a bug): Pix charge creation
// is a PUT to a caller-chosen /pix/v2/cob/{txid} path, so retrying it with
// the SAME txid is safe at the PROVIDER level (Inter's own idempotency).
// Boleto creation is a POST to /cobranca/v3/cobrancas with `seuNumero` only
// as a body field, which the existing provider client does not query back
// by before creating — there is no evidence in the current Inter integration
// (services/payments/inter/boleto.ts) that Inter deduplicates POSTs by
// seuNumero, and no "list boletos by seuNumero" capability exists to check
// before retrying. The claim gate below (created -> pending, no reference
// yet) protects against TRUE CONCURRENT double-claims (only one of two
// simultaneous callers may win it; the loser never reaches the provider
// call). It does NOT protect a SEQUENTIAL retry after this function's own
// provider call throws (e.g. a timeout, Section 17): a retry with the same
// idempotency key would observe the exact same DB state ("pending", no
// provider_reference) that a race-losing concurrent caller would — the two
// cases are indistinguishable from the row alone. Rather than guess, this
// function refuses to auto-retry from that state at all — see
// NativeInterBoletoAmbiguousRetryError. A caller in that state must resolve
// it out-of-band (support/reconciliation) before this can be safely
// retried; this module does not invent a query-by-seuNumero capability the
// existing client does not have.
export class NativeInterBoletoAmbiguousRetryError extends Error {
  readonly code = "NATIVE_INTER_BOLETO_AMBIGUOUS_RETRY_BLOCKED";
  readonly attemptId: string;
  constructor(attemptId: string) {
    super(
      "Tentativa de boleto nativo ficou em 'pending' sem referência do provedor (timeout ambíguo ou disputa em andamento). " +
        "Reenvio automático bloqueado: uma nova cobrança de boleto não é idempotente no provedor.",
    );
    this.name = "NativeInterBoletoAmbiguousRetryError";
    this.attemptId = attemptId;
  }
}

export async function createNativeInterBoletoPayment(
  input: CreateNativeInterBoletoInput,
  deps: NativeInterBoletoDeps = defaultBoletoDeps,
): Promise<NativeInterBoletoResult> {
  const attempt = await deps.createAttempt({
    orderId: input.orderId,
    provider: "banco_inter",
    method: "boleto",
    amountMinor: input.amountMinor,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
  });

  if (attempt.status !== "created") {
    if (attempt.status === "pending" && !attempt.providerReference) {
      throw new NativeInterBoletoAmbiguousRetryError(attempt.id);
    }
    return { attempt, charge: null };
  }

  let claimed;
  try {
    claimed = await deps.transitionAttempt({
      attemptId: attempt.id,
      expected: "created",
      target: "pending",
      expectedVersion: attempt.version,
    });
  } catch (error) {
    if (isStalePaymentAttemptTransition(error)) return { attempt, charge: null };
    throw error;
  }

  const seuNumero = deriveNativeInterBoletoSeuNumero(claimed.idempotencyKey);
  const charge = await deps.createCharge({
    seuNumero,
    amount: Number(input.amountMinor) / 100,
    payerDocument: input.payerDocument,
    payerName: input.payerName,
    billingAddress: input.billingAddress,
  });

  const withReference = await deps.transitionAttempt({
    attemptId: claimed.id,
    expected: "pending",
    target: "pending",
    expectedVersion: claimed.version,
    providerReference: charge.requestCode,
    providerStatus: charge.status,
  });

  const initialStatus = normalizeInterBoletoAttemptStatus(charge.status);
  const withInitialEvent = await deps.applyVerifiedTransition({
    attemptId: withReference.id,
    eventType: "status_observed",
    observedStatus: charge.status,
    resultingStatus: initialStatus,
  });

  return {
    attempt: { ...withReference, status: withInitialEvent.paymentStatus ?? withReference.status },
    charge,
  };
}

export async function getNativeInterBoletoPresentation(
  attempt: Pick<NativePaymentAttempt, "providerReference">,
  deps: Pick<NativeInterBoletoDeps, "getChargeStatus"> = defaultBoletoDeps,
): Promise<BoletoCharge> {
  if (!attempt.providerReference) {
    throw new InterPaymentError(409, "Tentativa de boleto ainda não tem referência do provedor", "INTER_NATIVE_NO_PROVIDER_REFERENCE");
  }
  return deps.getChargeStatus(attempt.providerReference);
}

export async function getNativeInterBoletoPdf(
  attempt: Pick<NativePaymentAttempt, "providerReference">,
  getPdf: typeof getBoletoPdfBase64 = getBoletoPdfBase64,
): Promise<string> {
  if (!attempt.providerReference) {
    throw new InterPaymentError(409, "Tentativa de boleto ainda não tem referência do provedor", "INTER_NATIVE_NO_PROVIDER_REFERENCE");
  }
  return getPdf(attempt.providerReference);
}

// ---------------------------------------------------------------------------
// Verification — WEBHOOK BODY != PAYMENT AUTHORITY (Section 10)
// ---------------------------------------------------------------------------

export type NativeInterMethod = "pix" | "boleto";

export interface VerifyNativeInterStatusDeps {
  getPixStatus: typeof getPixChargeStatus;
  getBoletoStatus: typeof getBoletoChargeStatus;
}

const defaultVerifyDeps: VerifyNativeInterStatusDeps = {
  getPixStatus: getPixChargeStatus,
  getBoletoStatus: getBoletoChargeStatus,
};

// Always queries the provider directly by the attempt's own
// provider_reference — the caller's claimed status (webhook body, or
// anything else) is NEVER passed in here and NEVER trusted.
export async function verifyNativeInterPaymentStatus(
  method: NativeInterMethod,
  providerReference: string,
  deps: VerifyNativeInterStatusDeps = defaultVerifyDeps,
): Promise<{ observedStatus: string; resultingStatus: PaymentAttemptStatus }> {
  if (method === "pix") {
    const charge = await deps.getPixStatus(providerReference);
    return { observedStatus: charge.status, resultingStatus: normalizeInterPixAttemptStatus(charge) };
  }
  const charge = await deps.getBoletoStatus(providerReference);
  return { observedStatus: charge.status, resultingStatus: normalizeInterBoletoAttemptStatus(charge.status) };
}

export interface ApplyNativeInterWebhookInput {
  attemptId: string;
  method: NativeInterMethod;
  providerReference: string;
  /** Raw provider identifier of the webhook delivery itself (not the
   * charge), used purely for event dedupe (Section 11) — its value is never
   * trusted for the resulting status. */
  externalEventId: string;
}

export interface ApplyNativeInterWebhookDeps extends VerifyNativeInterStatusDeps {
  applyVerifiedTransition: typeof applyVerifiedPaymentTransition;
}

const defaultWebhookDeps: ApplyNativeInterWebhookDeps = {
  ...defaultVerifyDeps,
  applyVerifiedTransition: applyVerifiedPaymentTransition,
};

// Delivered 1x, 10x, or concurrently: the (provider, external_event_id)
// unique constraint on payment_events (enforced inside
// record_native_payment_event, which apply_verified_payment_transition
// calls internally, attempt row locked before deciding dedupe — see
// docs/database/74) guarantees exactly one logical effect no matter how
// many times this function runs for the SAME webhook delivery. Routing
// through the SHARED orchestrator (supabase/migrations/20260921000000_
// shared_payment_order_inventory_orchestration.sql, docs/database/78)
// rather than calling recordNativePaymentEvent directly means a verified
// paid/terminal-failure outcome observed via webhook also drives the
// native order transition and inventory confirm/release atomically — not
// just the payment ledger row.
export async function applyNativeInterWebhookNotification(
  input: ApplyNativeInterWebhookInput,
  deps: ApplyNativeInterWebhookDeps = defaultWebhookDeps,
) {
  const verified = await verifyNativeInterPaymentStatus(input.method, input.providerReference, deps);
  return deps.applyVerifiedTransition({
    attemptId: input.attemptId,
    eventType: "webhook_received",
    externalEventId: input.externalEventId,
    observedStatus: verified.observedStatus,
    resultingStatus: verified.resultingStatus,
  });
}

export interface ReconcileNativeInterAttemptInput {
  attemptId: string;
  method: NativeInterMethod;
  providerReference: string;
}

export async function reconcileNativeInterPendingAttempt(
  input: ReconcileNativeInterAttemptInput,
  deps: ApplyNativeInterWebhookDeps = defaultWebhookDeps,
) {
  const verified = await verifyNativeInterPaymentStatus(input.method, input.providerReference, deps);
  return deps.applyVerifiedTransition({
    attemptId: input.attemptId,
    eventType: "reconciliation_probe",
    externalEventId: null,
    observedStatus: verified.observedStatus,
    resultingStatus: verified.resultingStatus,
  });
}
