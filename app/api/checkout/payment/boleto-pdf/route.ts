import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CART_TOKEN_COOKIE } from "@/app/api/cart/cart-response";
import { getPrivateCartHeaders } from "@/lib/commerce/cartResponsePolicy";
import { boletoPdfQuerySchema } from "@/lib/validation/payments";
import { getServerAccountSession } from "@/services/account/serverSession";
import { getBoletoPdfBase64 } from "@/services/payments/inter/boleto";
import { InterPaymentError } from "@/services/payments/inter/errors";
import { isAuthorizedForOrderStatus } from "@/services/payments/statusAuthorization";
import { findOrderByPaymentReference, WooCommerceRestError } from "@/services/woocommerce/orders";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const GENERIC_ERROR_MESSAGE = "Não foi possível baixar o boleto agora.";
const UNAUTHORIZED_MESSAGE = "Não autorizado.";

function createPrivateErrorResponse(message: string, status: number) {
  const response = NextResponse.json({ message }, { status });
  for (const [name, value] of Object.entries(getPrivateCartHeaders())) {
    response.headers.set(name, value);
  }
  return response;
}

function getErrorStatus(error: unknown): number {
  if (error instanceof InterPaymentError || error instanceof WooCommerceRestError) {
    const status = error.status ?? 502;
    return status === 404 ? 404 : status === 503 ? 503 : 502;
  }
  return 500;
}

// Mesma checagem de autorização da rota de status (services/payments/
// statusAuthorization): só quem criou o pedido pode baixar o boleto. O PDF
// nunca é cacheado por CDN/navegador — pode conter dados do pagador.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = boletoPdfQuerySchema.safeParse({
      reference: url.searchParams.get("reference"),
    });
    if (!parsed.success) {
      return createPrivateErrorResponse("Parâmetros inválidos.", 400);
    }
    const { reference } = parsed.data;

    const order = await findOrderByPaymentReference("inter", reference);
    if (!order) {
      return createPrivateErrorResponse(UNAUTHORIZED_MESSAGE, 401);
    }

    const requestCartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;
    const session = await getServerAccountSession();
    if (!isAuthorizedForOrderStatus(order, requestCartToken, session?.customer.email)) {
      return createPrivateErrorResponse(UNAUTHORIZED_MESSAGE, 401);
    }

    const pdfBase64 = await getBoletoPdfBase64(reference);
    const pdfBuffer = Buffer.from(pdfBase64, "base64");

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="boleto-pedido-${order.id}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const status = getErrorStatus(error);
    console.error("[checkout-payment-boleto-pdf]", {
      status,
      code: error instanceof Error ? error.name : "UNKNOWN",
    });
    return createPrivateErrorResponse(GENERIC_ERROR_MESSAGE, status);
  }
}
