import { cookies } from "next/headers";
import {
  CartServiceError,
  getCart,
} from "@/services/woocommerce/cart";
import {
  CART_TOKEN_COOKIE,
  createCartErrorResponse,
  createCartResponse,
} from "./cart-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const cartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;

  try {
    const result = await getCart(cartToken);
    return createCartResponse(result.cart, result.cartToken);
  } catch (error) {
    const status = error instanceof CartServiceError ? error.status : 500;

    return createCartErrorResponse(
      "Não foi possível carregar o carrinho.",
      status,
      cartToken,
    );
  }
}
