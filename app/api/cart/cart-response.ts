import { NextResponse } from "next/server";
import type { Cart } from "@/types/cart";
import {
  CART_CACHE_CONTROL,
  getCartTokenCookieOptions,
  getPrivateCartHeaders,
} from "@/lib/commerce/cartResponsePolicy";

export const CART_TOKEN_COOKIE = "persi_cart_token";
export { CART_CACHE_CONTROL };

function applyPrivateCartHeaders(response: NextResponse) {
  for (const [name, value] of Object.entries(getPrivateCartHeaders())) {
    response.headers.set(name, value);
  }
  return response;
}

export function createCartResponse(cart: Cart, cartToken?: string) {
  const response = applyPrivateCartHeaders(NextResponse.json(cart));

  return persistCartToken(response, cartToken);
}

function persistCartToken(response: NextResponse, cartToken?: string) {
  if (cartToken) {
    response.cookies.set(
      CART_TOKEN_COOKIE,
      cartToken,
      getCartTokenCookieOptions(process.env.NODE_ENV === "production"),
    );
  }

  return response;
}

export function createCartErrorResponse(
  message: string,
  status: number,
  cartToken?: string,
) {
  return persistCartToken(
    applyPrivateCartHeaders(NextResponse.json({ message }, { status })),
    cartToken,
  );
}
