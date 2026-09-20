import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";
import { findNativePaymentAttemptByProviderReference } from "@/lib/db/nativePayment";
import { logNativeCommerceEvent } from "@/lib/observability/nativeCommerceEvents";
import { isNativeCheckoutRuntimeEnabled } from "@/lib/runtime/native-checkout-mode";
import { applyNativePagBankWebhookNotification } from "@/services/payments/pagbank/nativeAdapter";

// ACCELERATED ROUND — Track D: native webhook boundary (PagBank).
// Separate from, and does not modify, the live app/api/webhooks/pagbank/
// route.ts (stays wired to the legacy WooCommerce flow). See
// app/api/webhooks/native/inter/route.ts for the shared design rationale.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const CHARGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,60}$/;

interface PagBankWebhookBody {
  id?: unknown;
  charges?: { id?: unknown }[];
}

function extractChargeId(body: unknown): string | null {
  const payload = body as PagBankWebhookBody | null;
  const candidate = payload?.charges?.[0]?.id ?? payload?.id;
  return typeof candidate === "string" && CHARGE_ID_PATTERN.test(candidate) ? candidate : null;
}

function digestEventId(rawBody: string, reference: string): string {
  return createHash("sha256").update(`pagbank:${reference}:${rawBody}`).digest("hex");
}

async function reconcileReference(reference: string, rawBody: string) {
  const attempt = await findNativePaymentAttemptByProviderReference("pagbank", reference);
  if (!attempt) return;
  const result = await applyNativePagBankWebhookNotification({
    attemptId: attempt.id,
    providerReference: reference,
    externalEventId: digestEventId(rawBody, reference),
  });
  logNativeCommerceEvent("native_webhook_reconciliation_applied", {
    provider: "pagbank", paymentAttemptId: attempt.id, orderId: result.orderId, status: result.paymentStatus,
  });
}

export async function POST(request: Request) {
  if (!isNativeCheckoutRuntimeEnabled()) {
    return NextResponse.json({ received: false }, { status: 404, headers: NO_STORE_HEADERS });
  }
  if (exceedsRequestLimit(request)) {
    return NextResponse.json({ received: false }, { status: 413, headers: NO_STORE_HEADERS });
  }

  const rawBody = await request.text();
  const body = (() => {
    try { return JSON.parse(rawBody); } catch { return null; }
  })();
  const chargeId = extractChargeId(body);
  logNativeCommerceEvent("native_webhook_received", { provider: "pagbank", code: chargeId ? "found" : "no_reference" });
  if (!chargeId) {
    return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
  }

  try {
    await reconcileReference(chargeId, rawBody);
  } catch (error) {
    logNativeCommerceEvent("native_webhook_processing_failed", {
      provider: "pagbank", code: error instanceof Error ? error.name : "UNKNOWN",
    });
    return NextResponse.json({ received: false }, { status: 502, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
}
