import { cookies } from "next/headers";
import {
  CART_TOKEN_COOKIE,
  createCartErrorResponse,
  createCartResponse,
} from "@/app/api/cart/cart-response";
import { selectCartShippingRate } from "@/services/woocommerce/cart";
import {
  exceedsRequestLimit,
  getCheckoutError,
  shippingRatePayloadSchema,
} from "../checkout-request";

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
  const body = await request.json().catch(() => null);
  const parsed = shippingRatePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return createCartErrorResponse(
      "A opção de entrega selecionada é inválida.",
      400,
      cartToken,
    );
  }
  try {
    const result = await selectCartShippingRate(parsed.data, cartToken);
    return createCartResponse(result.cart, result.cartToken);
  } catch (error) {
    const mapped = getCheckoutError(error, "shipping");
    return createCartErrorResponse(mapped.message, mapped.status, cartToken);
  }
}
