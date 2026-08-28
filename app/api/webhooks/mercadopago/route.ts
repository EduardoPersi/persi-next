import { NextResponse } from "next/server";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";
import { getCardChargeStatus } from "@/services/payments/mercadopago/charge";
import { categorizeMercadoPagoCardStatus, reconcilePaymentReference } from "@/services/payments/reconcile";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };
const PAYMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,60}$/;

interface MercadoPagoWebhookBody {
  data?: { id?: unknown };
  id?: unknown;
}

// O Mercado Pago manda o id do pagamento tanto por query string (formato
// IPN legado: ?data.id=123&type=payment) quanto no corpo JSON (webhooks v2:
// { action: "payment.updated", data: { id: "123" } }) — aceita os dois.
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

// Mesmo princípio dos webhooks do Inter e do PagBank: o corpo nunca é fonte
// de verdade sobre o pagamento, só fornece o identificador da cobrança. O
// status é sempre reconsultado direto na API do Mercado Pago antes de
// atualizar o pedido (ver services/payments/reconcile.ts).
export async function POST(request: Request) {
  if (exceedsRequestLimit(request)) {
    return NextResponse.json({ received: false }, { status: 413, headers: NO_STORE_HEADERS });
  }

  const body = await request.json().catch(() => null);
  const paymentId = extractPaymentId(request, body);

  if (!paymentId) {
    return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
  }

  try {
    const charge = await getCardChargeStatus(paymentId);
    await reconcilePaymentReference("mercadopago", paymentId, categorizeMercadoPagoCardStatus(charge.status));
  } catch (error) {
    console.error("[webhook-mercadopago]", { code: error instanceof Error ? error.name : "UNKNOWN" });
    return NextResponse.json({ received: false }, { status: 502, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
}

// GET aceito porque o Mercado Pago também pode chamar o webhook via GET
// no formato IPN legado (id só na query string, sem corpo).
export async function GET(request: Request) {
  const paymentId = extractPaymentId(request, null);

  if (!paymentId) {
    return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
  }

  try {
    const charge = await getCardChargeStatus(paymentId);
    await reconcilePaymentReference("mercadopago", paymentId, categorizeMercadoPagoCardStatus(charge.status));
  } catch (error) {
    console.error("[webhook-mercadopago]", { code: error instanceof Error ? error.name : "UNKNOWN" });
    return NextResponse.json({ received: false }, { status: 502, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
}
