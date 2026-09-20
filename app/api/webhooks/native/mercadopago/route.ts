import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";
import { findNativePaymentAttemptByProviderReference } from "@/lib/db/nativePayment";
import { logNativeCommerceEvent } from "@/lib/observability/nativeCommerceEvents";
import { isNativeCheckoutRuntimeEnabled } from "@/lib/runtime/native-checkout-mode";
import { applyNativeMercadoPagoWebhookNotification } from "@/services/payments/mercadopago/nativeAdapter";

// ACCELERATED ROUND — Track D: native webhook boundary (Mercado Pago).
// Separate from, and does not modify, the live app/api/webhooks/mercadopago/
// route.ts (stays wired to the legacy WooCommerce flow). See
// app/api/webhooks/native/inter/route.ts for the shared design rationale.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const PAYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,60}$/;

interface MercadoPagoWebhookBody {
  data?: { id?: unknown };
  id?: unknown;
}

function extractPaymentId(request: Request, body: unknown): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  if (fromQuery && PAYMENT_ID_PATTERN.test(fromQuery)) return fromQuery;

  const payload = body as MercadoPagoWebhookBody | null;
  const fromBody = payload?.data?.id ?? payload?.id;
  return typeof fromBody === "string" && PAYMENT_ID_PATTERN.test(fromBody)
    ? fromBody
    : typeof fromBody === "number"
      ? String(fromBody)
      : null;
}

function digestEventId(rawBody: string, reference: string): string {
  return createHash("sha256").update(`mercadopago:${reference}:${rawBody}`).digest("hex");
}

async function reconcileReference(reference: string, rawBody: string) {
  const attempt = await findNativePaymentAttemptByProviderReference("mercado_pago", reference);
  if (!attempt) return;
  const result = await applyNativeMercadoPagoWebhookNotification({
    attemptId: attempt.id,
    providerReference: reference,
    externalEventId: digestEventId(rawBody, reference),
  });
  logNativeCommerceEvent("native_webhook_reconciliation_applied", {
    provider: "mercado_pago", paymentAttemptId: attempt.id, orderId: result.orderId, status: result.paymentStatus,
  });
}

async function handle(request: Request, rawBody: string): Promise<Response> {
  if (!isNativeCheckoutRuntimeEnabled()) {
    return NextResponse.json({ received: false }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const body = (() => {
    try { return rawBody ? JSON.parse(rawBody) : null; } catch { return null; }
  })();
  const paymentId = extractPaymentId(request, body);
  logNativeCommerceEvent("native_webhook_received", { provider: "mercado_pago", code: paymentId ? "found" : "no_reference" });
  if (!paymentId) {
    return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
  }

  try {
    await reconcileReference(paymentId, rawBody || paymentId);
  } catch (error) {
    logNativeCommerceEvent("native_webhook_processing_failed", {
      provider: "mercado_pago", code: error instanceof Error ? error.name : "UNKNOWN",
    });
    return NextResponse.json({ received: false }, { status: 502, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  if (exceedsRequestLimit(request)) {
    return NextResponse.json({ received: false }, { status: 413, headers: NO_STORE_HEADERS });
  }
  return handle(request, await request.text());
}

// GET accepted for the same reason as the legacy route: Mercado Pago may
// call the legacy IPN format (id only in the query string, no body).
export async function GET(request: Request) {
  return handle(request, "");
}
