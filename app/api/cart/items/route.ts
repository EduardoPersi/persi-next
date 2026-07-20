import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  addItemToCart,
  CartServiceError,
} from "@/services/woocommerce/cart";

const CART_TOKEN_COOKIE = "persi_cart_token";

function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0
    ? value
    : undefined;
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Dados inválidos." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { message: "Dados inválidos." },
      { status: 400 },
    );
  }

  const input = body as Record<string, unknown>;
  const productId = parsePositiveInteger(input.productId);
  const quantity = parsePositiveInteger(input.quantity);

  if (!productId || !quantity || quantity > 100) {
    return NextResponse.json(
      { message: "Produto ou quantidade inválidos." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();

  try {
    const result = await addItemToCart(
      { productId, quantity },
      cookieStore.get(CART_TOKEN_COOKIE)?.value,
    );
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
    const unavailable = status === 400 || status === 409;

    return NextResponse.json(
      {
        message: unavailable
          ? "Este produto não está disponível no momento."
          : "Não foi possível adicionar o produto. Tente novamente.",
      },
      { status },
    );
  }
}
