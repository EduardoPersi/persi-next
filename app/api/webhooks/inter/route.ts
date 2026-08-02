import { NextResponse } from "next/server";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";
import { getBoletoChargeStatus } from "@/services/payments/inter/boleto";
import { getPixChargeStatus } from "@/services/payments/inter/pix";
import {
  categorizeBoletoStatus,
  categorizePixStatus,
  reconcilePaymentReference,
} from "@/services/payments/reconcile";

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

// Princípio central: o corpo do webhook nunca é tratado como fonte de
// verdade sobre pagamento. Dele só extraímos o identificador da cobrança
// (com validação de formato) — o status em si é sempre reconsultado direto
// na API do Inter antes de qualquer atualização de pedido. O Banco Inter não
// assina o payload do webhook Pix/cobrança com um HMAC verificável (ver
// docs/25-checkout-gateway-audit.md e o plano de implementação), então esta
// rota trata qualquer POST recebido apenas como um "toque" para reconsultar.
export async function POST(request: Request) {
  if (exceedsRequestLimit(request)) {
    return NextResponse.json({ received: false }, { status: 413, headers: NO_STORE_HEADERS });
  }

  const body = await request.json().catch(() => null);
  const txids = extractPixTxids(body);
  const boletoRequestCode = extractBoletoRequestCode(body);

  try {
    for (const txid of txids) {
      const charge = await getPixChargeStatus(txid);
      await reconcilePaymentReference("inter", txid, categorizePixStatus(charge));
    }

    if (boletoRequestCode) {
      const charge = await getBoletoChargeStatus(boletoRequestCode);
      await reconcilePaymentReference(
        "inter",
        boletoRequestCode,
        categorizeBoletoStatus(charge.status),
      );
    }
  } catch (error) {
    console.error("[webhook-inter]", { code: error instanceof Error ? error.name : "UNKNOWN" });
    // Erro transitório: responde 5xx para o Inter reentregar o webhook mais
    // tarde, em vez de fingir sucesso.
    return NextResponse.json({ received: false }, { status: 502, headers: NO_STORE_HEADERS });
  }

  return NextResponse.json({ received: true }, { status: 200, headers: NO_STORE_HEADERS });
}
