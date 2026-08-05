import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CART_TOKEN_COOKIE } from "@/app/api/cart/cart-response";
import { getPrivateCartHeaders } from "@/lib/commerce/cartResponsePolicy";
import { paymentStatusQuerySchema } from "@/lib/validation/payments";
import { getServerAccountSession } from "@/services/account/serverSession";
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
import { isAuthorizedForOrderStatus } from "@/services/payments/statusAuthorization";
import {
  findOrderByPaymentReference,
  WooCommerceRestError,
  type PaymentProvider,
} from "@/services/woocommerce/orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const GENERIC_ERROR_MESSAGE = "Não foi possível consultar o pagamento agora.";
// Mesma mensagem/status tanto para "pedido não encontrado" quanto para
// "encontrado mas não autorizado" — não dá pra confirmar nem negar a
// existência do pedido para quem não provou ter relação com ele.
const UNAUTHORIZED_MESSAGE = "Não autorizado.";

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
    const paymentProvider: PaymentProvider =
      provider === "pagbank_card" ? "pagbank" : "inter";

    // Resolve o pedido localmente (sem tocar Inter/PagBank) antes de mais
    // nada — só consulta o provedor depois de confirmar que quem está
    // perguntando tem relação com esse pedido.
    const order = await findOrderByPaymentReference(paymentProvider, reference);
    if (!order) {
      return createPrivateResponse({ message: UNAUTHORIZED_MESSAGE }, 401);
    }

    const requestCartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;
    const session = await getServerAccountSession();
    if (!isAuthorizedForOrderStatus(order, requestCartToken, session?.customer.email)) {
      return createPrivateResponse({ message: UNAUTHORIZED_MESSAGE }, 401);
    }

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
      // A criação já tenta algumas vezes até a linha digitável ficar pronta
      // (ver createBoletoCharge), mas se ainda estiver "EM_PROCESSAMENTO" na
      // resposta inicial, o cliente reconsulta aqui até ela aparecer.
      return createPrivateResponse(
        {
          status: charge.status,
          category,
          digitableLine: charge.digitableLine,
          barcode: charge.barcode,
          dueDate: charge.dueDate,
        },
        200,
      );
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
