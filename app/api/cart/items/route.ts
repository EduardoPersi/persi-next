import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addItemToCart,
  CartServiceError,
  updateCartItem,
  removeCartItem,
} from "@/services/woocommerce/cart";

const CART_TOKEN_COOKIE = "persi_cart_token";
const MAX_CART_QUANTITY = 999;

const variationAttributeSchema = z.object({
  attribute: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(200),
}).strict();

const addCartItemSchema = z
  .object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive().max(MAX_CART_QUANTITY),
    variationId: z.number().int().positive().optional(),
    variation: z.array(variationAttributeSchema).min(1).max(20).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.variationId) !== Boolean(value.variation?.length)) {
      context.addIssue({
        code: "custom",
        message: "A variaÃ§Ã£o estÃ¡ incompleta.",
      });
    }
  });

const cartItemKeySchema = z.object({
  key: z.string().trim().min(1).max(100),
}).strict();

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

  const parsedInput = addCartItemSchema.safeParse(body);

  if (!parsedInput.success) {
    return NextResponse.json(
      { message: "Produto ou quantidade inválidos." },
      { status: 400 },
    );
  }
  const input = parsedInput.data;

  const cookieStore = await cookies();

  try {
    const result = await addItemToCart(
      {
        productId: input.variationId ?? input.productId,
        quantity: input.quantity,
        variation: input.variation,
      },
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

export async function DELETE(request: Request) {
  const cartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;

  if (!cartToken) {
    return NextResponse.json(
      { message: "Carrinho nÃ£o encontrado." },
      { status: 404 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedInput = cartItemKeySchema.safeParse(body);

  if (!parsedInput.success) {
    return NextResponse.json(
      { message: "Item invÃ¡lido." },
      { status: 400 },
    );
  }

  try {
    const result = await removeCartItem(parsedInput.data.key, cartToken);
    return NextResponse.json(result.cart);
  } catch (error) {
    const status = error instanceof CartServiceError ? error.status : 500;
    return NextResponse.json(
      {
        message:
          status === 400 || status === 404 || status === 409
            ? "Este item nÃ£o estÃ¡ mais no carrinho."
            : "NÃ£o foi possÃ­vel remover o item. Tente novamente.",
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
