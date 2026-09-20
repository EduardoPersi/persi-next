import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";
import { findNativePaymentAttemptByProviderReference } from "@/lib/db/nativePayment";
import { logNativeCommerceEvent } from "@/lib/observability/nativeCommerceEvents";
import { isNativeCheckoutRuntimeEnabled } from "@/lib/runtime/native-checkout-mode";
import { applyNativeInterWebhookNotification } from "@/services/payments/inter/nativeAdapter";

// ACCELERATED ROUND — Track D: native webhook boundary (Banco Inter).
//
// A SEPARATE, currently-unreachable route from the live
// app/api/webhooks/inter/route.ts, which is untouched by this round and
// stays wired exclusively to the legacy WooCommerce order flow
// (services/payments/reconcile.ts -> services/woocommerce/orders.ts). No
// Inter webhook subscription in any environment points at this URL yet --
// wiring one is a staging task (docs/database/86), not something this
// round activates.
//
// Same "webhook body is NOT payment authority" principle as the legacy
// route (docs/database/75 Section 8): only a charge identifier (txid /
// codigoSolicitacao) is extracted, format-validated, and used to look up
// the matching native payment_attempt; the actual status is always
// re-verified by applyNativeInterWebhookNotification's own provider
// re-query (services/payments/inter/nativeAdapter.ts), never trusted from
// this payload. Fails closed while native runtime is off.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const TXID_PATTERN = /^[A-Za-z0-9]{26,35}$/;
const REQUEST_CODE_PATTERN = /^[A-Za-z0-9-]{1,60}$/;

interface InterPixWebhookBody {
  pix?: { txid?: unknown }[];
}

interface InterBoletoWebhookBody {
  codigoSolicitacao?: unknown;
}

function extractPixTxids(body: unknown): string[] {
  const pixEvents = (body as InterPixWebhookBody | null)?.pix;
  if (!Array.isArray(pixEvents)) return [];
  return pixEvents
    .map((event) => event?.txid)
    .filter((txid): txid is string => typeof txid === "string" && TXID_PATTERN.test(txid));
}

function extractBoletoRequestCode(body: unknown): string | null {
  const value = (body as InterBoletoWebhookBody | null)?.codigoSolicitacao;
  return typeof value === "string" && REQUEST_CODE_PATTERN.test(value) ? value : null;
}

// Inter does not sign this payload (same caveat as the legacy route) and
// provides no reliable delivery id -- a digest of the raw body is used for
// payment_events dedupe instead. This means genuinely distinct deliveries
// with the same body collapse to one ledger event (audit-log tidiness
// only); state convergence does not depend on this choice -- apply_
// verified_payment_transition's own before/after version check is what
// actually makes a replay a safe no-op, exactly as it already does for
// reconciliation probes, which pass externalEventId: null entirely.
function digestEventId(rawBody: string, reference: string): string {
  return createHash("sha256").update(`inter:${reference}:${rawBody}`).digest("hex");
}

async function reconcileReference(reference: string, method: "pix" | "boleto", rawBody: string) {
  const attempt = await findNativePaymentAttemptByProviderReference("banco_inter", reference);
  if (!attempt) return; // Unknown reference: not this route's concern (could be a legacy Woo-anchored charge).
  if (attempt.method !== method) return; // Defensive: never dispatch pix verification for a boleto attempt or vice versa.
  const result = await applyNativeInterWebhookNotification({
    attemptId: attempt.id,
    method,
    providerReference: reference,
    externalEventId: digestEventId(rawBody, reference),
  });
  logNativeCommerceEvent("native_webhook_reconciliation_applied", {
    provider: "banco_inter", method, paymentAttemptId: attempt.id, orderId: result.orderId, status: result.paymentStatus,
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
  const txids = extractPixTxids(body);
  const boletoRequestCode = extractBoletoRequestCode(body);
  logNativeCommerceEvent("native_webhook_received", { provider: "banco_inter", code: String(txids.length + (boletoRequestCode ? 1 : 0)) });

  try {
    for (const txid of txids) await reconcileReference(txid, "pix", rawBody);
    if (boletoRequestCode) await reconcileReference(boletoRequestCode, "boleto", rawBody);
  } catch (error) {
    logNativeCommerceEvent("native_webhook_processing_failed", {
      provider: "banco_inter", code: error instanceof Error ? error.name : "UNKNOWN",
    });
    return NextResponse.json({ received: false }, { status: 502, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
}
