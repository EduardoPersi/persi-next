import "server-only";

import { randomUUID } from "node:crypto";
import {
  submitNativeCheckout,
  type NativeOrderAddressInput,
} from "@/lib/db/nativeCheckout";
import { readNativeOrder, type NativeOrderReadModel } from "@/lib/db/nativeOrder";
import {
  createNativePaymentAttempt,
  transitionNativePaymentAttempt,
  applyVerifiedPaymentTransition,
} from "@/lib/db/nativePayment";
import {
  createNativeInterPixPayment,
  type NativeInterPixDeps,
  type NativeInterPixResult,
} from "@/services/payments/inter/nativeAdapter";
import { createPixCharge, getPixCharge, getPixChargeStatus } from "@/services/payments/inter/pix";
import {
  createNativeInterBoletoPayment,
  type NativeInterBoletoDeps,
  type NativeInterBoletoResult,
} from "@/services/payments/inter/nativeAdapter";
import { createBoletoCharge, getBoletoChargeStatus } from "@/services/payments/inter/boleto";
import {
  createNativeMercadoPagoCardPayment,
  type NativeMercadoPagoCardDeps,
  type NativeMercadoPagoCardResult,
} from "@/services/payments/mercadopago/nativeAdapter";
import { createCardCharge as createMercadoPagoCardCharge, getCardChargeStatus as getMercadoPagoCardChargeStatus } from "@/services/payments/mercadopago/charge";
import {
  createNativePagBankWalletPayment,
  type NativePagBankWalletDeps,
  type NativePagBankWalletResult,
} from "@/services/payments/pagbank/nativeAdapter";
import { createCardCharge as createPagBankCardCharge, getCardChargeStatus as getPagBankCardChargeStatus } from "@/services/payments/pagbank/charge";

// B.3-I — NATIVE CHECKOUT → PAYMENT WIRING. This is the ONLY new
// orchestration layer this round adds. It is deliberately thin: every step
// below calls an already-built, already-tested authority (native checkout
// submission, a payment ledger primitive, or a gateway adapter) — nothing
// here re-implements price/shipping/inventory validation, the payment
// state machine, or provider-specific normalization. If a future change
// needs any of that logic to differ, it belongs in the authority being
// called, not here.
//
// Order-before-provider (Section 15): submitNativeCheckout (which creates
// the persistent native order + inventory reservations) always runs BEFORE
// any adapter/provider call. There is no code path in this file that talks
// to a provider before a reconcilable native order exists.
//
// Nothing in this module is called from any route in this round —
// NATIVE_CHECKOUT_RUNTIME_ENABLED stays NO regardless of this file's own
// correctness (see lib/runtime/native-checkout-mode.ts).

export type NativeCheckoutPaymentMethod =
  | "inter_pix"
  | "inter_boleto"
  | "mercadopago_card"
  | "pagbank_apple_pay"
  | "pagbank_google_pay";

const KNOWN_PAYMENT_METHODS: ReadonlySet<string> = new Set<NativeCheckoutPaymentMethod>([
  "inter_pix",
  "inter_boleto",
  "mercadopago_card",
  "pagbank_apple_pay",
  "pagbank_google_pay",
]);

export class NativeCheckoutError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "NativeCheckoutError";
    this.code = code;
  }
}

// Fail-closed (Section 7): anything not in KNOWN_PAYMENT_METHODS is
// rejected before ANY database write happens — no order, no attempt, no
// provider call for an unrecognized method.
function assertKnownPaymentMethod(method: string): asserts method is NativeCheckoutPaymentMethod {
  if (!KNOWN_PAYMENT_METHODS.has(method)) {
    throw new NativeCheckoutError("UNKNOWN_PAYMENT_METHOD", `Método de pagamento não suportado: ${method}`);
  }
}

// ---------------------------------------------------------------------------
// Payment-method-specific input (Section 8: everything here is an
// ephemeral, browser-supplied CREDENTIAL or CONTACT DETAIL — never an
// amount, a status, or a provider reference; those are always derived
// server-side from the native order and the ledger, never from this input).
// ---------------------------------------------------------------------------

export type NativeCheckoutPaymentInput =
  | { method: "inter_pix"; payerDocument: string; payerName: string; description: string }
  | { method: "inter_boleto"; payerDocument: string; payerName: string }
  | {
      method: "mercadopago_card";
      /** SDK-issued, single-use card token — never a raw PAN/CVV. Never
       * persisted or logged anywhere by this service or the adapter it
       * calls. */
      cardToken: string;
      installments: number;
      paymentMethodId: string;
      issuerId?: string;
      holderDocument: string;
      holderName: string;
      holderEmail: string;
    }
  | {
      method: "pagbank_apple_pay" | "pagbank_google_pay";
      /** SDK-issued wallet token — same handling as the card token above. */
      cardToken: string;
      holderDocument: string;
      holderName: string;
      holderEmail: string;
    };

export interface SubmitNativeCommerceCheckoutInput {
  checkoutId: string;
  expectedVersion: bigint;
  idempotencyKey: string;
  customerId?: string | null;
  guestToken?: string;
  expectedPiiFingerprint: string;
  expectedDestinationFingerprint: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  billingAddress: NativeOrderAddressInput;
  shippingAddress: NativeOrderAddressInput;
  taxId?: { type: "cpf" | "cnpj"; ciphertext: string; fingerprint: string; masked: string } | null;
  payment: NativeCheckoutPaymentInput;
}

export type NativeCheckoutPresentationResult =
  | {
      method: "inter_pix";
      orderId: string;
      orderNumber: string;
      paymentStatus: string;
      qrCodeCopyPaste: string | null;
      qrCodeImageBase64: string | null;
      expiresAt: string | null;
    }
  | {
      method: "inter_boleto";
      orderId: string;
      orderNumber: string;
      paymentStatus: string;
      digitableLine: string | null;
      barcode: string | null;
      dueDate: string | null;
    }
  | {
      method: "mercadopago_card";
      orderId: string;
      orderNumber: string;
      paymentStatus: string;
      brand: string | null;
      lastDigits: string | null;
      installments: number | null;
    }
  | {
      method: "pagbank_apple_pay" | "pagbank_google_pay";
      orderId: string;
      orderNumber: string;
      paymentStatus: string;
      brand: string | null;
      lastDigits: string | null;
    };

// Injectable seams: ONLY the provider-facing calls are overridable (for
// tests to mock the provider without touching the DB). Every DB-facing
// dependency (createAttempt/transitionAttempt/applyVerifiedTransition)
// always uses the real ledger — a "mocked provider, real Postgres" test
// exercises the true idempotency/concurrency/atomicity guarantees, not a
// fake of them.
export interface NativeCheckoutServiceProviderMocks {
  /** Full deps overrides, per adapter. The real E2E/concurrency harnesses
   * only ever override the provider-facing fields (createCharge/getCharge/
   * getChargeStatus), leaving createAttempt/transitionAttempt/
   * applyVerifiedTransition at their real, Postgres-backed defaults —
   * that's what makes those harnesses a genuine proof of the ledger's
   * idempotency/concurrency/atomicity, not a mock of it. Pure routing/DTO
   * unit tests (tests/nativeCheckoutService.test.mjs) override every field
   * instead, so they touch no database at all. */
  interPix?: Partial<NativeInterPixDeps>;
  interBoleto?: Partial<NativeInterBoletoDeps>;
  mercadoPagoCard?: Partial<NativeMercadoPagoCardDeps>;
  pagbankWallet?: Partial<NativePagBankWalletDeps>;
  /** Unit-test-only seam for the native-order-submission step itself
   * (never used by the real E2E/concurrency harnesses, which always hit
   * real Postgres for this step — only for pure routing/DTO tests that
   * should not need a database at all). */
  submitCheckout?: typeof submitNativeCheckout;
  readOrder?: typeof readNativeOrder;
}

function interPixDeps(mocks?: NativeCheckoutServiceProviderMocks): NativeInterPixDeps {
  return {
    createCharge: createPixCharge,
    getCharge: getPixCharge,
    getChargeStatus: getPixChargeStatus,
    createAttempt: createNativePaymentAttempt,
    transitionAttempt: transitionNativePaymentAttempt,
    applyVerifiedTransition: applyVerifiedPaymentTransition,
    ...mocks?.interPix,
  };
}

function interBoletoDeps(mocks?: NativeCheckoutServiceProviderMocks): NativeInterBoletoDeps {
  return {
    createCharge: createBoletoCharge,
    getChargeStatus: getBoletoChargeStatus,
    createAttempt: createNativePaymentAttempt,
    transitionAttempt: transitionNativePaymentAttempt,
    applyVerifiedTransition: applyVerifiedPaymentTransition,
    ...mocks?.interBoleto,
  };
}

function mercadoPagoCardDeps(mocks?: NativeCheckoutServiceProviderMocks): NativeMercadoPagoCardDeps {
  return {
    createCharge: createMercadoPagoCardCharge,
    getChargeStatus: getMercadoPagoCardChargeStatus,
    createAttempt: createNativePaymentAttempt,
    transitionAttempt: transitionNativePaymentAttempt,
    applyVerifiedTransition: applyVerifiedPaymentTransition,
    ...mocks?.mercadoPagoCard,
  };
}

function pagbankWalletDeps(mocks?: NativeCheckoutServiceProviderMocks): NativePagBankWalletDeps {
  return {
    createCharge: createPagBankCardCharge,
    getChargeStatus: getPagBankCardChargeStatus,
    createAttempt: createNativePaymentAttempt,
    transitionAttempt: transitionNativePaymentAttempt,
    applyVerifiedTransition: applyVerifiedPaymentTransition,
    ...mocks?.pagbankWallet,
  };
}

function toCheckoutStoreAddress(address: NativeOrderAddressInput): {
  firstName: string; lastName: string; address1: string; city: string; state: string; postcode: string; country: "BR";
} {
  // Native order addresses store one `recipient` field (Section 21's
  // presentation contract, and submit_native_checkout's own schema, never
  // split first/last name); the legacy Inter boleto request shape
  // (services/payments/inter/boleto.ts, unchanged) predates the native
  // order and still wants firstName/lastName separately. This split is a
  // presentation-boundary convenience only — the FULL recipient name is
  // always what gets sent to the provider in the end (firstName+lastName
  // concatenation is never re-parsed back into anything authoritative).
  const [firstName, ...rest] = address.recipient.trim().split(/\s+/);
  return {
    firstName: firstName || address.recipient,
    lastName: rest.join(" "),
    address1: `${address.street}, ${address.number}`,
    city: address.city,
    state: address.state,
    postcode: address.postalCode,
    country: "BR",
  };
}

// The single, thin orchestrator. Every failure mode in Section 14's matrix
// maps to a specific point below:
//  - A/B/C (price/shipping/inventory stale) -> submitNativeCheckout itself
//    throws (CHECKOUT_PRICE_STALE / CHECKOUT_SHIPPING_QUOTE_INVALID /
//    CHECKOUT_RESERVATION_*), before this function reaches the payment
//    section at all -> no payment_attempt, no provider call.
//  - D (order created, payment preparation fails before any provider call)
//    -> see Section 16 in docs/database/79: recovery is "retry this whole
//    function with the SAME checkoutId+idempotencyKey" — submitNativeCheckout
//    and createNativePaymentAttempt are BOTH idempotent, so a retry
//    converges on the same order and the same attempt, never a duplicate.
//  - E/F (provider timeout/rejection) -> the called adapter's own,
//    already-qualified timeout/rejection handling applies unchanged.
//  - G (DB failure before payment attempt) -> nothing provider-facing has
//    run yet; zero provider calls by construction (order-before-provider).
//  - H (DB failure after provider uncertainty) -> exactly the scenario the
//    gateway adapters' own claim-gate / ambiguous-retry-blocking designs
//    (docs/database/75 §5, 77 §4) already exist to make reconciliation-safe;
//    not re-solved here.
export async function submitNativeCommerceCheckout(
  input: SubmitNativeCommerceCheckoutInput,
  mocks?: NativeCheckoutServiceProviderMocks,
): Promise<NativeCheckoutPresentationResult> {
  assertKnownPaymentMethod(input.payment.method);

  // 1. native order (ALWAYS before any provider call — Section 15).
  const submitCheckoutFn = mocks?.submitCheckout ?? submitNativeCheckout;
  const readOrderFn = mocks?.readOrder ?? readNativeOrder;
  const submission = await submitCheckoutFn({
    checkoutId: input.checkoutId,
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.idempotencyKey,
    customerId: input.customerId,
    guestToken: input.guestToken,
    expectedPiiFingerprint: input.expectedPiiFingerprint,
    expectedDestinationFingerprint: input.expectedDestinationFingerprint,
    orderId: randomUUID(), // ignored by submit_native_checkout on an idempotent replay — see docs/database/79 §3
    correlationId: randomUUID(),
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    billingAddress: input.billingAddress,
    shippingAddress: input.shippingAddress,
    taxId: input.taxId,
  });

  const order = await readOrderFn(submission.orderId);
  if (!order) throw new NativeCheckoutError("NATIVE_ORDER_READ_FAILED_AFTER_SUBMISSION");

  // 2. Authoritative amount/currency come ONLY from the just-created native
  // order — never from `input` (Section 8: the browser cannot be the
  // authority for a total).
  const amountMinor = order.grandTotalMinor;
  const currency = order.currency;
  // Reusing the checkout-level idempotency key as the payment attempt's own
  // key: create_native_payment_attempt dedupes on (provider, key), and
  // provider already scopes it, so the SAME checkout retried (even with a
  // freshly generated orderId above) always converges on the SAME logical
  // payment attempt too.
  const paymentIdempotencyKey = input.idempotencyKey;

  switch (input.payment.method) {
    case "inter_pix": {
      const result: NativeInterPixResult = await createNativeInterPixPayment(
        {
          orderId: order.id, amountMinor, currency, idempotencyKey: paymentIdempotencyKey,
          payerDocument: input.payment.payerDocument, payerName: input.payment.payerName, description: input.payment.description,
        },
        interPixDeps(mocks),
      );
      return {
        method: "inter_pix", orderId: order.id, orderNumber: order.orderNumber, paymentStatus: result.attempt.status,
        qrCodeCopyPaste: result.charge?.qrCodeCopyPaste ?? null,
        qrCodeImageBase64: result.charge?.qrCodeImageBase64 ?? null,
        expiresAt: result.charge?.expiresAt ?? null,
      };
    }
    case "inter_boleto": {
      const result: NativeInterBoletoResult = await createNativeInterBoletoPayment(
        {
          orderId: order.id, amountMinor, currency, idempotencyKey: paymentIdempotencyKey,
          payerDocument: input.payment.payerDocument, payerName: input.payment.payerName,
          billingAddress: toCheckoutStoreAddress(input.billingAddress),
        },
        interBoletoDeps(mocks),
      );
      return {
        method: "inter_boleto", orderId: order.id, orderNumber: order.orderNumber, paymentStatus: result.attempt.status,
        digitableLine: result.charge?.digitableLine || null,
        barcode: result.charge?.barcode || null,
        dueDate: result.charge?.dueDate || null,
      };
    }
    case "mercadopago_card": {
      const result: NativeMercadoPagoCardResult = await createNativeMercadoPagoCardPayment(
        {
          orderId: order.id, amountMinor, currency, idempotencyKey: paymentIdempotencyKey,
          cardToken: input.payment.cardToken, installments: input.payment.installments, paymentMethodId: input.payment.paymentMethodId,
          issuerId: input.payment.issuerId, holderDocument: input.payment.holderDocument, holderName: input.payment.holderName, holderEmail: input.payment.holderEmail,
        },
        mercadoPagoCardDeps(mocks),
      );
      return {
        method: "mercadopago_card", orderId: order.id, orderNumber: order.orderNumber, paymentStatus: result.attempt.status,
        brand: result.charge?.brand ?? null, lastDigits: result.charge?.lastDigits ?? null, installments: result.charge?.installments ?? null,
      };
    }
    case "pagbank_apple_pay":
    case "pagbank_google_pay": {
      const walletMethod = input.payment.method === "pagbank_apple_pay" ? "apple_pay" : "google_pay";
      const result: NativePagBankWalletResult = await createNativePagBankWalletPayment(
        {
          orderId: order.id, walletMethod, amountMinor, currency, idempotencyKey: paymentIdempotencyKey,
          cardToken: input.payment.cardToken, holderDocument: input.payment.holderDocument, holderName: input.payment.holderName, holderEmail: input.payment.holderEmail,
        },
        pagbankWalletDeps(mocks),
      );
      return {
        method: input.payment.method, orderId: order.id, orderNumber: order.orderNumber, paymentStatus: result.attempt.status,
        brand: result.charge?.brand ?? null, lastDigits: result.charge?.lastDigits ?? null,
      };
    }
  }
}
