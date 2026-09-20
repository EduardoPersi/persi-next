import { NextResponse } from "next/server";
import { z } from "zod";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";
import { environmentCheckoutPiiKeys } from "@/lib/commerce/checkoutPii";
import { decryptNativeCheckoutPii } from "@/lib/db/nativeCheckoutPii";
import type { NativeOrderAddressInput } from "@/lib/db/nativeCheckout";
import { logNativeCommerceEvent } from "@/lib/observability/nativeCommerceEvents";
import { assertPaymentsAllowed } from "@/lib/runtime/external-write-guard";
import { isNativeCheckoutRuntimeEnabled } from "@/lib/runtime/native-checkout-mode";
import {
  NativeCheckoutError,
  submitNativeCommerceCheckout,
  type NativeCheckoutPaymentInput,
} from "@/services/checkout/nativeCheckoutService";

// ACCELERATED ROUND — Track C: native HTTP checkout boundary.
//
// This is the narrowest server-side wrapper around the already-qualified
// submitNativeCommerceCheckout (services/checkout/nativeCheckoutService.ts)
// — it re-implements none of that function's domain logic (price/shipping/
// inventory authority, the payment state machine, provider dispatch). It
// exists to prepare the real HTTP entrypoint WITHOUT enabling it: every
// request is rejected with 404 while isNativeCheckoutRuntimeEnabled() is
// false, which it unconditionally is this round (lib/runtime/
// native-checkout-mode.ts). NATIVE_CHECKOUT_RUNTIME_ENABLED stays NO.
//
// Design decisions worth recording (see docs/database/86 for the fuller
// staging-readiness writeup):
//
//  1. NO authoritative field is ever read from the request body. The
//     request accepts only: checkoutId, expectedVersion (optimistic
//     concurrency, not authority), idempotencyKey, a bearer guestToken, and
//     payment-method-specific EPHEMERAL fields that could only ever be
//     known client-side (an SDK-issued single-use card/wallet token,
//     installments, paymentMethodId/issuerId as chosen in the card form).
//     Contact name/email/phone, billing/shipping address, and the payer's
//     tax document are NEVER accepted from this request -- they are
//     derived server-side by decrypting the checkout's own already-
//     persisted, already-fingerprinted PII (persistNativeCheckoutPii, from
//     an earlier step in the flow this round does not build). This is
//     stricter than the spec's own minimum bar (which only forbids price/
//     shipping/payment-status/order-status/provider-reference from the
//     browser) because reusing the already-validated PII costs nothing
//     extra here and removes an entire class of "browser resubmits a
//     slightly different address than what was fingerprinted" mismatches.
//
//  2. Owner resolution is guest-token-only this round. Every existing
//     native-checkout script/test in this codebase (native-checkout-
//     payment-e2e.mjs, native-checkout-payment-concurrency.mjs) already
//     always passes customerId: null -- there is no existing mapping from
//     an authenticated WooCommerce/account session to a native `customers`
//     row (no such resolver exists anywhere in lib/db). Inventing one here
//     would be exactly the kind of unrequested schema/business-logic
//     addition this project's rules warn against. Documented as a known,
//     separate gap in docs/database/86, not silently worked around. The
//     guestToken itself is a high-entropy bearer credential (same trust
//     model as the WooCommerce cart's own CART_TOKEN_COOKIE), accepted from
//     the JSON body rather than a dedicated httpOnly cookie only because no
//     native-checkout cookie/session infrastructure exists yet to issue one
//     from -- a future round wiring the earlier checkout steps to HTTP
//     should move it there.
//
//  3. taxId is never populated (always null). encryptDurableTaxDocument's
//     AAD binds to a specific orderId, but submitNativeCommerceCheckout
//     generates the order's id internally and does not accept one from its
//     caller -- there is no way to encrypt a tax document bound to the
//     correct orderId before that order exists. No prior round's script or
//     test populates taxId either (all pass it implicitly undefined).
//     Solving this (a two-phase encrypt-after-create step, or an AAD that
//     doesn't bind to orderId) is a real, separate design decision, not
//     invented here.
//
//  4. No route-level idempotency/dedup bookkeeping (unlike the legacy
//     app/api/checkout/payment/route.ts's reserveCheckoutAttempt/
//     transitionCheckoutAttempt machinery). That machinery exists because
//     the legacy WooCommerce path is not atomic at the database level. The
//     native path already has idempotency built into submit_native_checkout
//     (checkoutId+idempotencyKey) and create_native_payment_attempt
//     (provider+idempotencyKey) themselves, proven under real concurrency
//     by scripts/database/native-checkout-payment-concurrency.mjs -- a
//     retried identical request converges on the same order/attempt by
//     construction, with no additional bookkeeping needed here (C10).
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const GENERIC_ERROR_MESSAGE = "Não foi possível concluir o pagamento. Tente novamente.";

const paymentSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("inter_pix") }).strict(),
  z.object({ method: z.literal("inter_boleto") }).strict(),
  z
    .object({
      method: z.literal("mercadopago_card"),
      cardToken: z.string().trim().min(1).max(4096),
      installments: z.number().int().min(1).max(12),
      paymentMethodId: z.string().trim().min(1).max(60),
      issuerId: z.string().trim().min(1).max(60).optional(),
    })
    .strict(),
  z
    .object({
      method: z.literal("pagbank_apple_pay"),
      cardToken: z.string().trim().min(1).max(4096),
    })
    .strict(),
  z
    .object({
      method: z.literal("pagbank_google_pay"),
      cardToken: z.string().trim().min(1).max(4096),
    })
    .strict(),
]);

const requestSchema = z
  .object({
    checkoutId: z.uuid(),
    // bigint-safe: a JSON number would lose precision for large versions,
    // so the wire format is a decimal string, parsed with BigInt() below.
    expectedVersion: z.string().regex(/^\d{1,20}$/, "expectedVersion inválido"),
    idempotencyKey: z.uuid(),
    guestToken: z.string().trim().min(32).max(200),
    payment: paymentSchema,
  })
  .strict();

function toNativeOrderAddress(address: {
  recipient: string;
  company?: string | null;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}): NativeOrderAddressInput {
  return {
    recipient: address.recipient,
    company: address.company ?? undefined,
    street: address.street,
    number: address.number,
    complement: address.complement ?? undefined,
    neighborhood: address.neighborhood,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
  };
}

function safePostgresMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  // Track B (docs/database/81): drizzle-orm wraps the real Postgres error
  // in .cause; error.message alone is always the generic "Failed query:
  // ..." string. Check .cause first so business-error codes raised by SQL
  // functions (CHECKOUT_NOT_FOUND, stale_checkout_version, etc.) are
  // actually recognized here instead of silently falling through to 502.
  const cause = error.cause;
  if (cause instanceof Error && cause.message) return cause.message;
  return error.message || null;
}

function mapError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof NativeCheckoutError) {
    if (error.code === "UNKNOWN_PAYMENT_METHOD") {
      return { status: 422, code: error.code, message: "Forma de pagamento não suportada." };
    }
    return { status: 500, code: error.code, message: GENERIC_ERROR_MESSAGE };
  }

  const message = safePostgresMessage(error) ?? "";
  if (message === "CHECKOUT_NOT_FOUND") {
    return { status: 404, code: "CHECKOUT_NOT_FOUND", message: "Checkout não encontrado." };
  }
  if (message === "CHECKOUT_OWNER_DENIED") {
    return { status: 403, code: "CHECKOUT_OWNER_DENIED", message: "Este checkout não pertence a você." };
  }
  if (message === "CHECKOUT_PII_REQUIRED" || message === "CHECKOUT_PII_EXPIRED") {
    return { status: 422, code: "CHECKOUT_PII_REQUIRED", message: "Complete seus dados de contato e endereço antes de pagar." };
  }
  if (
    message.startsWith("CHECKOUT_PRICE_") ||
    message.startsWith("CHECKOUT_SHIPPING_") ||
    message.startsWith("CHECKOUT_RESERVATION_") ||
    /^stale_(checkout_version|order_transition|payment_attempt_transition)/.test(message)
  ) {
    return { status: 409, code: "CHECKOUT_STALE", message: "O checkout foi atualizado. Recarregue a página e tente novamente." };
  }
  if (message === "NATIVE_CHECKOUT_OWNER_CONTEXT_INVALID") {
    return { status: 422, code: "NATIVE_CHECKOUT_OWNER_CONTEXT_INVALID", message: "Dados de identificação inválidos." };
  }
  return { status: 502, code: "PAYMENT_SUBMISSION_FAILED", message: GENERIC_ERROR_MESSAGE };
}

function providerIdFor(method: NativeCheckoutPaymentInput["method"]): string {
  if (method === "inter_pix" || method === "inter_boleto") return "banco_inter";
  if (method === "mercadopago_card") return "mercado_pago";
  return "pagbank";
}

export async function POST(request: Request) {
  // Fail-closed: independent of everything else in this file, no request
  // ever reaches the native checkout service while the runtime flag is off.
  if (!isNativeCheckoutRuntimeEnabled()) {
    logNativeCommerceEvent("native_checkout_submission_rejected_runtime_disabled", {});
    return NextResponse.json(
      { code: "NATIVE_CHECKOUT_DISABLED", message: "Checkout nativo indisponível." },
      { status: 404 },
    );
  }

  if (exceedsRequestLimit(request)) {
    return NextResponse.json({ code: "PAYLOAD_TOO_LARGE", message: "Requisição muito grande." }, { status: 413 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ code: "INVALID_REQUEST", message: "Dados de pagamento inválidos." }, { status: 400 });
  }
  const input = parsed.data;

  let expectedVersion: bigint;
  try {
    expectedVersion = BigInt(input.expectedVersion);
  } catch {
    return NextResponse.json({ code: "INVALID_REQUEST", message: "Dados de pagamento inválidos." }, { status: 400 });
  }

  const owner = { customerId: null, guestToken: input.guestToken } as const;

  try {
    assertPaymentsAllowed(providerIdFor(input.payment.method), "native_checkout_submit");

    const pii = await decryptNativeCheckoutPii({
      checkoutId: input.checkoutId,
      owner,
      keys: environmentCheckoutPiiKeys(),
    });
    const contactName = `${pii.envelope.contact.firstName} ${pii.envelope.contact.lastName}`.trim();
    const billingAddress = toNativeOrderAddress(pii.envelope.billing);
    const shippingAddress = pii.envelope.shippingSameAsBilling
      ? billingAddress
      : toNativeOrderAddress(pii.envelope.shipping);
    const payerDocument = pii.envelope.contact.taxDocument;

    let payment: NativeCheckoutPaymentInput;
    switch (input.payment.method) {
      case "inter_pix":
        payment = { method: "inter_pix", payerDocument, payerName: contactName, description: "Pedido Persi Materiais" };
        break;
      case "inter_boleto":
        payment = { method: "inter_boleto", payerDocument, payerName: contactName };
        break;
      case "mercadopago_card":
        payment = {
          method: "mercadopago_card",
          cardToken: input.payment.cardToken,
          installments: input.payment.installments,
          paymentMethodId: input.payment.paymentMethodId,
          issuerId: input.payment.issuerId,
          holderDocument: payerDocument,
          holderName: contactName,
          holderEmail: pii.envelope.contact.email,
        };
        break;
      case "pagbank_apple_pay":
      case "pagbank_google_pay":
        payment = {
          method: input.payment.method,
          cardToken: input.payment.cardToken,
          holderDocument: payerDocument,
          holderName: contactName,
          holderEmail: pii.envelope.contact.email,
        };
        break;
    }

    const result = await submitNativeCommerceCheckout({
      checkoutId: input.checkoutId,
      expectedVersion,
      idempotencyKey: input.idempotencyKey,
      customerId: owner.customerId,
      guestToken: owner.guestToken,
      expectedPiiFingerprint: pii.fingerprint,
      expectedDestinationFingerprint: pii.destinationFingerprint,
      contactName,
      contactEmail: pii.envelope.contact.email,
      contactPhone: pii.envelope.contact.phone || null,
      billingAddress,
      shippingAddress,
      taxId: null,
      payment,
    });

    logNativeCommerceEvent("native_checkout_submission_succeeded", {
      checkoutId: input.checkoutId,
      orderId: result.orderId,
      method: result.method,
      status: result.paymentStatus,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const mapped = mapError(error);
    // Correlation only -- never the raw error, which could contain a
    // provider response body or a full Postgres error detail string.
    logNativeCommerceEvent("native_checkout_submission_failed", {
      checkoutId: input.checkoutId,
      method: input.payment.method,
      code: mapped.code,
    });
    return NextResponse.json({ code: mapped.code, message: mapped.message }, { status: mapped.status });
  }
}
