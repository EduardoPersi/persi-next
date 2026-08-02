import { NextResponse } from "next/server";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";
import { getCardChargeStatus } from "@/services/payments/pagbank/charge";
import { categorizeCardStatus, reconcilePaymentReference } from "@/services/payments/reconcile";

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

// Mesmo princípio do webhook do Inter: o corpo nunca é fonte de verdade
// sobre o pagamento, só fornece o identificador da cobrança. O status é
// sempre reconsultado direto na API do PagBank antes de atualizar o pedido
// (ver services/payments/reconcile.ts).
export async function POST(request: Request) {
  if (exceedsRequestLimit(request)) {
    return NextResponse.json({ received: false }, { status: 413, headers: NO_STORE_HEADERS });
  }

  const body = await request.json().catch(() => null);
  const chargeId = extractChargeId(body);

  if (!chargeId) {
    return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
  }

  try {
    const charge = await getCardChargeStatus(chargeId);
    await reconcilePaymentReference("pagbank", chargeId, categorizeCardStatus(charge.status));
  } catch (error) {
    console.error("[webhook-pagbank]", { code: error instanceof Error ? error.name : "UNKNOWN" });
    return NextResponse.json({ received: false }, { status: 502, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
}
