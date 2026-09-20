import "server-only";

import {
  applyVerifiedPaymentTransition,
  createNativePaymentAttempt,
  transitionNativePaymentAttempt,
  type NativePaymentAttempt,
  type PaymentAttemptStatus,
  type PaymentMethod,
} from "@/lib/db/nativePayment";
import {
  createCardCharge,
  getCardChargeStatus,
  type CardChargeResult,
  type CardChargeStatus,
  type CardPaymentMethod,
} from "./charge";
import { PagBankPaymentError } from "./errors";

// B.3-G — NATIVE PagBank (Apple Pay + Google Pay) reanchoring. Same
// relationship to the legacy integration as the Inter and Mercado Pago
// native adapters: this module is the only new thing that talks to both the
// payment ledger (lib/db/nativePayment.ts) and the existing PagBank
// provider logic (./charge.ts, unchanged). It replaces WOO_ANCHORING only
// (referenceId derived from a Woo order id, and everything in
// services/woocommerce/orders.ts) — the legacy checkout route
// (app/api/checkout/payment/route.ts) is untouched and keeps calling
// createCardCharge/getCardChargeStatus exactly as it does today.
//
// PagBank credit/debit card (via mercadopago_card's own PagBank-independent
// path — actually PagBank only ever serves apple_pay/google_pay in the
// legacy route; see docs/database/77 section 1) is NOT this round's scope.
//
// AUDIT FINDING (Section 5/9): reading ./charge.ts shows Apple Pay and
// Google Pay are NOT two separate implementations today — both funnel
// through the exact same createCardCharge function and the exact same
// request shape (`payment_method.card.encrypted = cardToken`), differing
// ONLY in the `payment_method.type` string sent to PagBank
// ("APPLE_PAY" vs "GOOGLE_PAY"). This was verified by reading the code, not
// assumed — see CardPaymentMethod and PAGBANK_PAYMENT_METHOD_TYPE in
// ./charge.ts. This module mirrors that reality: one shared implementation,
// two named entry points for clarity and independent testability.
//
// AUDIT FINDING (Section 10): ./client.ts's pagbankRequest sends NO
// idempotency header of any kind, and createCardCharge accepts no
// idempotency parameter — unlike Mercado Pago (X-Idempotency-Key, already
// wired). PAGBANK_PROVIDER_IDEMPOTENCY_SUPPORTED = NO. This module
// therefore uses the SAME conservative strategy as Inter's Boleto adapter
// (services/payments/inter/nativeAdapter.ts), not Mercado Pago's — see
// NativePagBankWalletAmbiguousRetryError below.
//
// No real PagBank call happens anywhere in this module's own logic, and
// nothing in this round wires it into any route.

// ---------------------------------------------------------------------------
// Wallet security boundary (Section 6): this module only ever handles
// `cardToken` — the SDK-issued (Apple Pay JS / Google Pay API), already
// tokenized/encrypted string the existing checkout UI collects today (see
// CreateCardChargeInput in ./charge.ts — it has never accepted a raw
// PAN/CVV or an unencrypted wallet cryptogram; tokenization is a
// CHECKOUT_UI_CONCERN this round does not touch). The token is passed
// straight through to createCardCharge and is NEVER read back afterward,
// never logged, and never written to the ledger — payment_attempts/
// payment_events have no column for it. Only chargeId, brand, lastDigits
// and installments (exactly what the legacy path already persists via
// attachPaymentReference) are used anywhere in this module.
// ---------------------------------------------------------------------------

export type NativePagBankWalletMethod = Extract<PaymentMethod, "apple_pay" | "google_pay">;

const WALLET_TO_PAGBANK_METHOD: Record<NativePagBankWalletMethod, CardPaymentMethod> = {
  apple_pay: "apple_pay",
  google_pay: "google_pay",
};

// ---------------------------------------------------------------------------
// Status normalization (Section 13) — from the REAL status union already
// validated in ./charge.ts (CardChargeStatus), not assumed. Notably absent
// from that union: any refunded/charged-back value — if PagBank ever
// reported one, the existing (unmodified) assertChargeStatus would THROW
// PAGBANK_UNKNOWN_STATUS rather than silently misclassify it. See Section 6
// of docs/database/77 for why this is left exactly as-is.
// ---------------------------------------------------------------------------

export function normalizePagBankAttemptStatus(status: CardChargeStatus): PaymentAttemptStatus {
  if (status === "PAID") return "paid";
  if (status === "AUTHORIZED") return "authorized";
  if (status === "IN_ANALYSIS") return "pending";
  if (status === "DECLINED") return "failed";
  return "cancelled"; // CANCELED
}

// ---------------------------------------------------------------------------
// Error normalization — same category vocabulary as the Inter and Mercado
// Pago adapters. No raw provider message ever persisted.
// ---------------------------------------------------------------------------

export type NativePagBankErrorCategory =
  | "retryable"
  | "non_retryable"
  | "authentication"
  | "validation"
  | "provider_unavailable"
  | "timeout"
  | "conflict"
  | "not_found";

export interface NormalizedPagBankError {
  category: NativePagBankErrorCategory;
  httpStatus: number;
}

const NON_RETRYABLE_CODES = new Set([
  "PAGBANK_CONFIG_MISSING",
  "PAGBANK_UNKNOWN_STATUS",
  "PAGBANK_INVALID_RESPONSE",
]);

// client.ts (unchanged) never distinguishes a real network timeout from any
// other fetch failure — both raise PAGBANK_API_UNAVAILABLE. Treated as
// `timeout` here for the same reason documented in the Mercado Pago
// adapter: it is the closest signal the existing client provides for the
// "request sent, no response" case (Section 12); a real HTTP 4xx/5xx from
// PagBank itself surfaces as PAGBANK_API_ERROR instead.
export function normalizePagBankError(error: unknown): NormalizedPagBankError {
  if (error instanceof PagBankPaymentError) {
    if (error.code === "PAGBANK_API_UNAVAILABLE") return { category: "timeout", httpStatus: error.status };
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
// Wallet payment creation
// ---------------------------------------------------------------------------

export interface CreateNativePagBankWalletPaymentInput {
  orderId: string;
  walletMethod: NativePagBankWalletMethod;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  /** SDK-issued wallet token (Apple Pay JS / Google Pay API), already
   * tokenized before this input exists — see the security boundary note
   * above. Never a raw PAN/CVV/cryptogram. */
  cardToken: string;
  holderDocument: string;
  holderName: string;
  holderEmail: string;
}

export interface NativePagBankWalletResult {
  attempt: NativePaymentAttempt;
  /** Present only when THIS call actually talked to the provider. */
  charge: CardChargeResult | null;
}

export interface NativePagBankWalletDeps {
  createCharge: typeof createCardCharge;
  getChargeStatus: typeof getCardChargeStatus;
  createAttempt: typeof createNativePaymentAttempt;
  transitionAttempt: typeof transitionNativePaymentAttempt;
  applyVerifiedTransition: typeof applyVerifiedPaymentTransition;
}

const defaultDeps: NativePagBankWalletDeps = {
  createCharge: createCardCharge,
  getChargeStatus: getCardChargeStatus,
  createAttempt: createNativePaymentAttempt,
  transitionAttempt: transitionNativePaymentAttempt,
  applyVerifiedTransition: applyVerifiedPaymentTransition,
};

// Also checks error.cause -- reached through lib/db/nativePayment.ts
// (drizzle-orm) the real Postgres message lives there, not on the
// DrizzleQueryError's own .message. See
// services/payments/inter/nativeAdapter.ts's copy of this function for the
// full note (first found by B.3-I's checkout-service concurrency harness).
function isStalePaymentAttemptTransition(error: unknown): boolean {
  const pattern = /stale_payment_attempt_transition/;
  if (error instanceof Error && pattern.test(error.message)) return true;
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof Error && pattern.test(cause.message);
}

// UNLIKE Mercado Pago (real provider-side X-Idempotency-Key, already wired
// and trusted for safe retry — see services/payments/mercadopago/
// nativeAdapter.ts), PagBank's own client has NO idempotency mechanism at
// all (Section 10 finding above). A sequential retry after this function's
// own provider call throws (e.g. a timeout) lands on the exact same DB
// state ("pending", no provider_reference) that a race-losing concurrent
// caller would — indistinguishable from the row alone, and here there is
// not even a provider-side safety net to fall back on. Exactly like Inter's
// Boleto adapter, this function refuses to auto-retry from that state.
export class NativePagBankWalletAmbiguousRetryError extends Error {
  readonly code = "NATIVE_PAGBANK_WALLET_AMBIGUOUS_RETRY_BLOCKED";
  readonly attemptId: string;
  constructor(attemptId: string) {
    super(
      "Tentativa de pagamento PagBank (wallet) ficou em 'pending' sem referência do provedor " +
        "(timeout ambíguo ou disputa em andamento). Reenvio automático bloqueado: o PagBank não " +
        "expõe hoje nenhum mecanismo de idempotência para esta chamada.",
    );
    this.name = "NativePagBankWalletAmbiguousRetryError";
    this.attemptId = attemptId;
  }
}

// Idempotent, retry-safe AT THE LEDGER LEVEL: the SAME (orderId,
// idempotencyKey) always converges on the SAME logical payment_attempt.
// Duplicate-charge safety at the PROVIDER level rests entirely on the claim
// gate below (created -> pending, no reference, before any provider call) —
// there is no provider-side backstop to rely on for PagBank, unlike
// Mercado Pago.
export async function createNativePagBankWalletPayment(
  input: CreateNativePagBankWalletPaymentInput,
  deps: NativePagBankWalletDeps = defaultDeps,
): Promise<NativePagBankWalletResult> {
  const attempt = await deps.createAttempt({
    orderId: input.orderId,
    provider: "pagbank",
    method: input.walletMethod,
    amountMinor: input.amountMinor,
    currency: input.currency,
    idempotencyKey: input.idempotencyKey,
  });

  if (attempt.status !== "created") {
    if (attempt.status === "pending" && !attempt.providerReference) {
      throw new NativePagBankWalletAmbiguousRetryError(attempt.id);
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

  const charge = await deps.createCharge({
    referenceId: input.orderId, // native order id — never a Woo order id
    amount: Number(input.amountMinor) / 100,
    cardToken: input.cardToken,
    installments: 1, // wallets are always single-installment in the existing integration (app/api/checkout/payment/route.ts)
    paymentMethod: WALLET_TO_PAGBANK_METHOD[input.walletMethod],
    holderDocument: input.holderDocument,
    holderName: input.holderName,
    holderEmail: input.holderEmail,
  });

  const withReference = await deps.transitionAttempt({
    attemptId: claimed.id,
    expected: "pending",
    target: "pending",
    expectedVersion: claimed.version,
    providerReference: charge.chargeId,
    providerStatus: charge.status,
  });

  // Wallets are synchronous like Mercado Pago card (the first response is
  // usually already definitive: AUTHORIZED/PAID/DECLINED), unlike Pix/
  // Boleto. Applying it through the same event path used for every later
  // observation keeps this uniform.
  const initialStatus = normalizePagBankAttemptStatus(charge.status);
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

export async function createNativePagBankApplePayPayment(
  input: Omit<CreateNativePagBankWalletPaymentInput, "walletMethod">,
  deps: NativePagBankWalletDeps = defaultDeps,
): Promise<NativePagBankWalletResult> {
  return createNativePagBankWalletPayment({ ...input, walletMethod: "apple_pay" }, deps);
}

export async function createNativePagBankGooglePayPayment(
  input: Omit<CreateNativePagBankWalletPaymentInput, "walletMethod">,
  deps: NativePagBankWalletDeps = defaultDeps,
): Promise<NativePagBankWalletResult> {
  return createNativePagBankWalletPayment({ ...input, walletMethod: "google_pay" }, deps);
}

// ---------------------------------------------------------------------------
// Verification — WEBHOOK BODY != PAYMENT AUTHORITY (Section 14)
// ---------------------------------------------------------------------------

export interface VerifyNativePagBankStatusDeps {
  getChargeStatus: typeof getCardChargeStatus;
}

const defaultVerifyDeps: VerifyNativePagBankStatusDeps = { getChargeStatus: getCardChargeStatus };

export async function verifyNativePagBankPaymentStatus(
  providerReference: string,
  deps: VerifyNativePagBankStatusDeps = defaultVerifyDeps,
): Promise<{ observedStatus: string; resultingStatus: PaymentAttemptStatus }> {
  const charge = await deps.getChargeStatus(providerReference);
  return { observedStatus: charge.status, resultingStatus: normalizePagBankAttemptStatus(charge.status) };
}

export interface ApplyNativePagBankWebhookInput {
  attemptId: string;
  providerReference: string;
  externalEventId: string;
}

export interface ApplyNativePagBankWebhookDeps extends VerifyNativePagBankStatusDeps {
  applyVerifiedTransition: typeof applyVerifiedPaymentTransition;
}

const defaultWebhookDeps: ApplyNativePagBankWebhookDeps = {
  ...defaultVerifyDeps,
  applyVerifiedTransition: applyVerifiedPaymentTransition,
};

export async function applyNativePagBankWebhookNotification(
  input: ApplyNativePagBankWebhookInput,
  deps: ApplyNativePagBankWebhookDeps = defaultWebhookDeps,
) {
  const verified = await verifyNativePagBankPaymentStatus(input.providerReference, deps);
  return deps.applyVerifiedTransition({
    attemptId: input.attemptId,
    eventType: "webhook_received",
    externalEventId: input.externalEventId,
    observedStatus: verified.observedStatus,
    resultingStatus: verified.resultingStatus,
  });
}

export interface ReconcileNativePagBankAttemptInput {
  attemptId: string;
  providerReference: string;
}

export async function reconcileNativePagBankPendingAttempt(
  input: ReconcileNativePagBankAttemptInput,
  deps: ApplyNativePagBankWebhookDeps = defaultWebhookDeps,
) {
  const verified = await verifyNativePagBankPaymentStatus(input.providerReference, deps);
  return deps.applyVerifiedTransition({
    attemptId: input.attemptId,
    eventType: "reconciliation_probe",
    externalEventId: null,
    observedStatus: verified.observedStatus,
    resultingStatus: verified.resultingStatus,
  });
}
