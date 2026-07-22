import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  addItemToCart,
  CartServiceError,
  updateCartItem,
} from "@/services/woocommerce/cart";

const CART_TOKEN_COOKIE = "persi_cart_token";
const MAX_CART_QUANTITY = 999;

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

  if (!productId || !quantity || quantity > MAX_CART_QUANTITY) {
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

export async function PATCH(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "Dados inválidos." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const key = typeof input.key === "string" ? input.key.trim() : "";
  const quantity = parsePositiveInteger(input.quantity);

  if (!key || !quantity || quantity > MAX_CART_QUANTITY) {
    return NextResponse.json(
      { message: "Item ou quantidade inválidos." },
      { status: 400 },
    );
  }

  const cartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;

  if (!cartToken) {
    return NextResponse.json(
      { message: "Carrinho não encontrado." },
      { status: 404 },
    );
  }

  try {
    const result = await updateCartItem(key, quantity, cartToken);
    return NextResponse.json(result.cart);
  } catch (error) {
    const status = error instanceof CartServiceError ? error.status : 500;

    return NextResponse.json(
      {
        message:
          status === 400 || status === 409
            ? "A quantidade solicitada não está disponível."
            : "Não foi possível atualizar o carrinho. Tente novamente.",
      },
      { status },
    );
  }
}
