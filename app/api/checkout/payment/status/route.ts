import { NextResponse } from "next/server";
import { getPrivateCartHeaders } from "@/lib/commerce/cartResponsePolicy";
import { paymentStatusQuerySchema } from "@/lib/validation/payments";
import { getBoletoChargeStatus } from "@/services/payments/inter/boleto";
import { InterPaymentError } from "@/services/payments/inter/errors";
import { getPixChargeStatus } from "@/services/payments/inter/pix";
import { getCardChargeStatus } from "@/services/payments/pagbank/charge";
import { PagBankPaymentError } from "@/services/payments/pagbank/errors";
import {
  categorizeBoletoStatus,
  categorizeCardStatus,
  categorizePixStatus,
  reconcilePaymentReference,
} from "@/services/payments/reconcile";
import { WooCommerceRestError } from "@/services/woocommerce/orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const GENERIC_ERROR_MESSAGE = "Não foi possível consultar o pagamento agora.";

function createPrivateResponse(body: object, status: number) {
  const response = NextResponse.json(body, { status });
  for (const [name, value] of Object.entries(getPrivateCartHeaders())) {
    response.headers.set(name, value);
  }
  return response;
}

function getErrorStatus(error: unknown): number {
  if (
    error instanceof InterPaymentError ||
    error instanceof PagBankPaymentError ||
    error instanceof WooCommerceRestError
  ) {
    const status = (error as { status?: number }).status ?? 502;
    return status === 404 ? 404 : status === 503 ? 503 : 502;
  }
  return 500;
}

// A resposta desta rota nunca é um "status" pré-computado guardado em algum
// lugar: ela sempre reconsulta o provedor ao vivo (nunca confia em cache) e
// aproveita para reconciliar o pedido no WooCommerce, funcionando como um
// caminho alternativo ao webhook caso ele atrase ou falhe.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = paymentStatusQuerySchema.safeParse({
      provider: url.searchParams.get("provider"),
      reference: url.searchParams.get("reference"),
    });
    if (!parsed.success) {
      return createPrivateResponse({ message: "Parâmetros inválidos." }, 400);
    }
    const { provider, reference } = parsed.data;

    if (provider === "inter_pix") {
      const charge = await getPixChargeStatus(reference);
      const category = categorizePixStatus(charge);
      await reconcilePaymentReference("inter", reference, category);
      return createPrivateResponse({ status: charge.status, category }, 200);
    }

    if (provider === "inter_boleto") {
      const charge = await getBoletoChargeStatus(reference);
      const category = categorizeBoletoStatus(charge.status);
      await reconcilePaymentReference("inter", reference, category);
      return createPrivateResponse({ status: charge.status, category }, 200);
    }

    const charge = await getCardChargeStatus(reference);
    const category = categorizeCardStatus(charge.status);
    await reconcilePaymentReference("pagbank", reference, category);
    return createPrivateResponse({ status: charge.status, category }, 200);
  } catch (error) {
    const status = getErrorStatus(error);
    console.error("[checkout-payment-status]", {
      status,
      code: error instanceof Error ? error.name : "UNKNOWN",
    });
    return createPrivateResponse({ message: GENERIC_ERROR_MESSAGE }, status);
  }
}
