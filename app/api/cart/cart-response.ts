import { NextResponse } from "next/server";
import type { Cart } from "@/types/cart";

export const CART_TOKEN_COOKIE = "persi_cart_token";

const CART_CACHE_CONTROL =
  "private, no-store, no-cache, must-revalidate, max-age=0";

function applyPrivateCartHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", CART_CACHE_CONTROL);
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("Vary", "Cookie");
  return response;
}

export function createCartResponse(cart: Cart, cartToken?: string) {
  const response = applyPrivateCartHeaders(NextResponse.json(cart));

  return persistCartToken(response, cartToken);
}

function persistCartToken(response: NextResponse, cartToken?: string) {
  if (cartToken) {
    response.cookies.set(CART_TOKEN_COOKIE, cartToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
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
