import { cookies } from "next/headers";
import {
  CART_TOKEN_COOKIE,
  createCartErrorResponse,
  createCartResponse,
} from "@/app/api/cart/cart-response";
import {
  CartServiceError,
  updateCartShippingPostcode,
} from "@/services/woocommerce/cart";
import { lookupBrazilianPostcode } from "@/services/shipping/postcode";
import { cartShippingQuoteSchema } from "../shipping-request";
import { exceedsRequestLimit } from "@/app/api/checkout/checkout-request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const cartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;

  if (!cartToken) {
    return createCartErrorResponse(
      "Não foi possível localizar o carrinho. Recarregue a página.",
      404,
    );
  }

  if (exceedsRequestLimit(request)) {
    return createCartErrorResponse(
      "Os dados enviados excedem o tamanho permitido.",
      413,
      cartToken,
    );
  }

  const parsed = cartShippingQuoteSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return createCartErrorResponse("Informe um CEP válido.", 400, cartToken);
  }

  try {
    const [result, shippingDestination] = await Promise.all([
      updateCartShippingPostcode(parsed.data.postcode, cartToken),
      lookupBrazilianPostcode(parsed.data.postcode),
    ]);
    return createCartResponse(
      { ...result.cart, shippingDestination },
      result.cartToken,
    );
  } catch (error) {
    const status = error instanceof CartServiceError ? error.status : 500;
    const message =
      status === 400 || status === 404
        ? "Não foi possível localizar este CEP."
        : status === 504
          ? "O cálculo demorou mais que o esperado. Tente novamente."
          : "Não foi possível calcular o frete. Tente novamente.";
    return createCartErrorResponse(message, status, cartToken);
  }
}
