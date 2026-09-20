import "server-only";

import {
  applyVerifiedPaymentTransition,
  createNativePaymentAttempt,
  transitionNativePaymentAttempt,
  type NativePaymentAttempt,
  type PaymentAttemptStatus,
} from "@/lib/db/nativePayment";
import {
  createCardCharge,
  getCardChargeStatus,
  type CardChargeResult,
  type MercadoPagoChargeStatus,
} from "./charge";
import { MercadoPagoPaymentError } from "./errors";

// B.3-F — NATIVE Mercado Pago (card) reanchoring. Same relationship to the
// legacy integration as services/payments/inter/nativeAdapter.ts: this
// module is the ONLY new thing that talks to both the payment ledger
// (lib/db/nativePayment.ts) and the existing Mercado Pago provider logic
// (./charge.ts, unchanged). It replaces WOO_ANCHORING only (referenceId
// derived from a Woo order id, and everything in
// services/woocommerce/orders.ts) — the legacy checkout route
// (app/api/checkout/payment/route.ts) is untouched and keeps using
// createCardCharge/getCardChargeStatus exactly as it does today.
//
// Card is NOT PagBank Apple Pay/Google Pay — that is explicitly a separate,
// later phase (services/payments/pagbank/*, not touched here).
//
// No real Mercado Pago call happens anywhere in this module's own logic;
// whether a call happens at runtime depends entirely on the `request`
// function threaded through createCardCharge (injected in every test here,
// real only via the default in charge.ts, which itself refuses to run
// outside an environment that allows payments — see
// lib/runtime/external-write-guard.ts). Nothing in this round wires this
// adapter into any route.

// ---------------------------------------------------------------------------
// PCI boundary (Section 5): this module only ever handles `cardToken`, the
// SDK-issued, already-tokenized string the existing checkout UI already
// collects (see CreateCardChargeInput in ./charge.ts — it has never
// accepted a PAN/CVV, tokenization is a CHECKOUT_UI_CONCERN this round does
// not touch). The token is passed straight through to createCardCharge and
// is NEVER read back afterward, never logged, and never written to the
// ledger — payment_attempts/payment_events have no column for it, and
// nothing here puts it into provider_status, failure_reason, or any event
// field. Only chargeId, brand, lastDigits and installments (already exactly
// what the legacy path persists via attachPaymentReference) are used.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Deterministic, native-identity-derived idempotency key
// ---------------------------------------------------------------------------

// Unlike Inter's Pix/Boleto, Mercado Pago already supports a provider-level
// idempotency mechanism (client.ts sends the key as the `X-Idempotency-Key`
// header) — the legacy path already reuses its own (Woo-adjacent but
// already checkout-scoped, not Woo-order-id-scoped) idempotency key for
// this exact purpose. The native path does the same thing, but the key
// fed in is the ledger's own `payment_attempts.idempotency_key`
// (unique per (provider, key)), never anything derived from a Woo order.
// No transformation is needed (Mercado Pago places no format constraint on
// this header beyond it being a stable string), so this function exists
// only to name the decision and give tests one seam to assert against.
export function deriveNativeMercadoPagoIdempotencyKey(paymentAttemptIdempotencyKey: string): string {
  const trimmed = paymentAttemptIdempotencyKey.trim();
  if (!trimmed) {
    throw new MercadoPagoPaymentError(500, "Idempotency key vazia", "MERCADOPAGO_NATIVE_IDEMPOTENCY_KEY_INVALID");
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Status normalization (Section 11) — mapped from the REAL status union
// already validated in ./charge.ts (MercadoPagoChargeStatus), not assumed.
// ---------------------------------------------------------------------------

export function normalizeMercadoPagoAttemptStatus(status: MercadoPagoChargeStatus): PaymentAttemptStatus {
  if (status === "approved") return "paid";
  if (status === "authorized") return "authorized"; // captured later, or already captured (capture:true is always sent — see ./charge.ts) — kept distinct because the ledger already has this exact state.
  if (status === "in_process" || status === "pending") return "pending";
  if (status === "rejected") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "refunded") return "refunded";
  // "charged_back": a bank-initiated reversal AFTER the fact. The ledger has
  // no distinct chargeback state (Section 11 forbids inventing one for
  // convenience) — mapped to the closest existing state (money has left the
  // merchant), but this is a documented approximation, not a clean
  // semantic match: a chargeback is involuntary and has no corresponding
  // `refunds` row, unlike a real refund. See docs/database/76, section 6.
  return "refunded";
}

// ---------------------------------------------------------------------------
// Error normalization (Section 16 of the Inter round, reapplied identically
// here) — internal categories only, provider message never persisted.
// ---------------------------------------------------------------------------

export type NativeMercadoPagoErrorCategory =
  | "retryable"
  | "non_retryable"
  | "authentication"
  | "validation"
  | "provider_unavailable"
  | "timeout"
  | "conflict"
  | "not_found";

export interface NormalizedMercadoPagoError {
  category: NativeMercadoPagoErrorCategory;
  httpStatus: number;
}

const NON_RETRYABLE_CODES = new Set([
  "MERCADOPAGO_CONFIG_MISSING",
  "MERCADOPAGO_UNKNOWN_STATUS",
  "MERCADOPAGO_INVALID_DOCUMENT",
  "MERCADOPAGO_NATIVE_IDEMPOTENCY_KEY_INVALID",
]);

// client.ts (unchanged) never distinguishes a real network timeout from any
// other fetch failure — both raise MERCADOPAGO_API_UNAVAILABLE. Treated
// conservatively as `timeout` here (Section 10 cares specifically about the
// "request sent, no response" case, and API_UNAVAILABLE is the closest
// signal the existing client provides for it; a real HTTP 4xx/5xx from
// Mercado Pago itself always surfaces as MERCADOPAGO_API_ERROR instead).
export function normalizeMercadoPagoError(error: unknown): NormalizedMercadoPagoError {
  if (error instanceof MercadoPagoPaymentError) {
    if (error.code === "MERCADOPAGO_API_UNAVAILABLE") return { category: "timeout", httpStatus: error.status };
    if (NON_RETRYABLE_CODES.has(error.code)) return { category: "non_retryable", httpStatus: error.status };
    if (error.status === 401 || error.status === 403) return { category: "authentication", httpStatus: error.status };
    if (error.status === 404) return { category: "not_found", httpStatus: error.status };
    if (error.status === 409) return { category: "conflict", httpStatus: error.status };
    if (error.status >= 400 && error.status < 500) return { category: "validation", httpStatus: error.status };
    return { category: "provider_unavailable", httpStatus: error.status };
  }
  return { category: "provider_unavailable", httpStatus: 502 };
}

// ---------------------------------------------------------------------------
// Card payment creation
// ---------------------------------------------------------------------------

export interface CreateNativeMercadoPagoCardPaymentInput {
  orderId: string;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  /** SDK-issued card token — see the PCI boundary note above. Never a raw
   * PAN/CVV; tokenization already happens client-side before this input
   * exists (a CHECKOUT_UI_CONCERN, out of this module's scope). */
  cardToken: string;
  installments: number;
  paymentMethodId: string;
  issuerId?: string;
  holderDocument: string;
  holderName: string;
  holderEmail: string;
}

export interface NativeMercadoPagoCardResult {
  attempt: NativePaymentAttempt;
  /** Present only when THIS call actually talked to the provider. A pure
   * ledger-idempotent replay of an already-progressed attempt returns
   * null — callers needing the latest known state re-read the attempt
   * itself (it already carries status/providerReference). */
  charge: CardChargeResult | null;
}

export interface NativeMercadoPagoCardDeps {
  createCharge: typeof createCardCharge;
  getChargeStatus: typeof getCardChargeStatus;
  createAttempt: typeof createNativePaymentAttempt;
  transitionAttempt: typeof transitionNativePaymentAttempt;
  applyVerifiedTransition: typeof applyVerifiedPaymentTransition;
}

const defaultDeps: NativeMercadoPagoCardDeps = {
  createCharge: createCardCharge,
  getChargeStatus: getCardChargeStatus,
  createAttempt: createNativePaymentAttempt,
  transitionAttempt: transitionNativePaymentAttempt,
  applyVerifiedTransition: applyVerifiedPaymentTransition,
};

// Same message the ledger's own optimistic-concurrency check raises (see
// supabase/migrations/20260920000000_..._foundation.sql's
// transition_native_payment_attempt). Also checks error.cause, because
// reached through lib/db/nativePayment.ts (drizzle-orm) the real Postgres
// message lives there, not on the DrizzleQueryError's own .message — see
// the detailed note in services/payments/inter/nativeAdapter.ts's own copy
// of this function, where this was first found (B.3-I checkout-service
// concurrency harness).
function isStalePaymentAttemptTransition(error: unknown): boolean {
  const pattern = /stale_payment_attempt_transition/;
  if (error instanceof Error && pattern.test(error.message)) return true;
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof Error && pattern.test(cause.message);
}

// Idempotent, retry-safe: the SAME (orderId, idempotencyKey) always
// converges on the SAME logical payment_attempt and the SAME provider
// idempotency key.
//
// Concurrency design (Section 9): a claim gate (created -> pending, no
// reference yet) is applied BEFORE calling the provider, exactly like
// services/payments/inter/nativeAdapter.ts's Pix/Boleto flows — only one of
// two truly concurrent callers may win it; the loser returns quietly
// (charge: null) instead of racing into a second provider call. Applied
// uniformly here even though Mercado Pago's own `X-Idempotency-Key` header
// (already sent by the unmodified ./client.ts) should make a second
// provider call harmless on its own — the claim gate means this function's
// safety does NOT rest solely on trusting that provider behavior, and it
// keeps a second, cheaper, local guarantee that never needs a real network
// round-trip to resolve a race.
//
// Timeout design (Section 10): UNLIKE Inter's Boleto (a bare POST with no
// idempotency support), Mercado Pago's own idempotency-key mechanism is
// specifically designed so that a RETRIED create call with the SAME key
// after an ambiguous timeout returns the ALREADY-CREATED payment instead of
// creating a second one. This is a documented TRUST BOUNDARY on the
// provider's own idempotency implementation (not verified against the real
// API this round — no real Mercado Pago call is made anywhere here) rather
// than something this module can prove offline. Given that trust, a caller
// resuming from "pending, no provider_reference" (the same ambiguous state
// Inter's Boleto adapter refuses to touch) is allowed to safely retry here
// by re-supplying the SAME idempotency key — this function does not need
// (and does not have) an equivalent to
// NativeInterBoletoAmbiguousRetryError.
export async function createNativeMercadoPagoCardPayment(
  input: CreateNativeMercadoPagoCardPaymentInput,
  deps: NativeMercadoPagoCardDeps = defaultDeps,
): Promise<NativeMercadoPagoCardResult> {
  const attempt = await deps.createAttempt({
    orderId: input.orderId,
    provider: "mercado_pago",
    method: "credit_card",
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
    return { attempt, charge: null };
  }

  const providerIdempotencyKey = deriveNativeMercadoPagoIdempotencyKey(claimed.idempotencyKey);
  const charge = await deps.createCharge(
    {
      referenceId: input.orderId, // native order id — never a Woo order id
      amount: Number(input.amountMinor) / 100,
      cardToken: input.cardToken,
      installments: input.installments,
      paymentMethodId: input.paymentMethodId,
      issuerId: input.issuerId,
      holderDocument: input.holderDocument,
      holderName: input.holderName,
      holderEmail: input.holderEmail,
    },
    providerIdempotencyKey,
  );

  const withReference = await deps.transitionAttempt({
    attemptId: claimed.id,
    expected: "pending",
    target: "pending",
    expectedVersion: claimed.version,
    providerReference: charge.chargeId,
    providerStatus: charge.status,
  });

  // Card is synchronous (unlike Pix/Boleto): the very first response is
  // usually already the definitive outcome (approved/rejected), not merely
  // an acknowledgement. Applying it through the same event path used for
  // every later observation keeps this uniform and never bypasses the
  // ledger's own transition-validity rules.
  const initialStatus = normalizeMercadoPagoAttemptStatus(charge.status);
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

// ---------------------------------------------------------------------------
// Verification — WEBHOOK BODY != PAYMENT AUTHORITY (Section 13)
// ---------------------------------------------------------------------------

export interface VerifyNativeMercadoPagoStatusDeps {
  getChargeStatus: typeof getCardChargeStatus;
}

const defaultVerifyDeps: VerifyNativeMercadoPagoStatusDeps = { getChargeStatus: getCardChargeStatus };

// Always queries the provider directly by the attempt's own
// provider_reference (chargeId) — nothing the caller claims is trusted.
export async function verifyNativeMercadoPagoPaymentStatus(
  providerReference: string,
  deps: VerifyNativeMercadoPagoStatusDeps = defaultVerifyDeps,
): Promise<{ observedStatus: string; resultingStatus: PaymentAttemptStatus }> {
  const charge = await deps.getChargeStatus(providerReference);
  return { observedStatus: charge.status, resultingStatus: normalizeMercadoPagoAttemptStatus(charge.status) };
}

export interface ApplyNativeMercadoPagoWebhookInput {
  attemptId: string;
  providerReference: string;
  /** The webhook delivery's own identifier, used purely for event dedupe
   * (Section 14) — never trusted for the resulting status. Mercado Pago's
   * IPN/webhook body carries no reliable status of its own in the existing
   * integration (app/api/webhooks/mercadopago/route.ts already ignores it
   * and re-queries) — this parameter list has no place for one either. */
  externalEventId: string;
}

export interface ApplyNativeMercadoPagoWebhookDeps extends VerifyNativeMercadoPagoStatusDeps {
  applyVerifiedTransition: typeof applyVerifiedPaymentTransition;
}

const defaultWebhookDeps: ApplyNativeMercadoPagoWebhookDeps = {
  ...defaultVerifyDeps,
  applyVerifiedTransition: applyVerifiedPaymentTransition,
};

// Delivered 1x, 10x, or concurrently: the (provider, external_event_id)
// unique constraint inside record_native_payment_event (attempt row locked
// before the dedupe check) guarantees exactly one logical effect, same
// mechanism already proven for Inter and generically in Phase 2. Routing
// through the SHARED orchestrator (docs/database/78) also drives the order/
// inventory consequence atomically for a verified paid/terminal outcome.
export async function applyNativeMercadoPagoWebhookNotification(
  input: ApplyNativeMercadoPagoWebhookInput,
  deps: ApplyNativeMercadoPagoWebhookDeps = defaultWebhookDeps,
) {
  const verified = await verifyNativeMercadoPagoPaymentStatus(input.providerReference, deps);
  return deps.applyVerifiedTransition({
    attemptId: input.attemptId,
    eventType: "webhook_received",
    externalEventId: input.externalEventId,
    observedStatus: verified.observedStatus,
    resultingStatus: verified.resultingStatus,
  });
}

export interface ReconcileNativeMercadoPagoAttemptInput {
  attemptId: string;
  providerReference: string;
}

export async function reconcileNativeMercadoPagoPendingAttempt(
  input: ReconcileNativeMercadoPagoAttemptInput,
  deps: ApplyNativeMercadoPagoWebhookDeps = defaultWebhookDeps,
) {
  const verified = await verifyNativeMercadoPagoPaymentStatus(input.providerReference, deps);
  return deps.applyVerifiedTransition({
    attemptId: input.attemptId,
    eventType: "reconciliation_probe",
    externalEventId: null,
    observedStatus: verified.observedStatus,
    resultingStatus: verified.resultingStatus,
  });
}
