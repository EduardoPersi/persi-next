import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  CartServiceError,
  getCart,
} from "@/services/woocommerce/cart";

const CART_TOKEN_COOKIE = "persi_cart_token";

export async function GET() {
  const cookieStore = await cookies();

  try {
    const result = await getCart(cookieStore.get(CART_TOKEN_COOKIE)?.value);
    const response = NextResponse.json(result.cart);

    if (result.cartToken) {
      response.cookies.set(CART_TOKEN_COOKIE, result.cartToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    return response;
  } catch (error) {
    const status = error instanceof CartServiceError ? error.status : 500;

    return NextResponse.json(
      { message: "Não foi possível carregar o carrinho." },
      { status },
    );
  }
}
