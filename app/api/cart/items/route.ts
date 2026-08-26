import { cookies } from "next/headers";
import { z } from "zod";
import {
  addItemToCart,
  CartServiceError,
  getCart,
  removeCartItem,
  updateCartItem,
} from "@/services/woocommerce/cart";
import {
  CART_TOKEN_COOKIE,
  createCartErrorResponse,
  createCartResponse,
} from "../cart-response";

const MAX_CART_QUANTITY = 999;

export const dynamic = "force-dynamic";
export const revalidate = 0;

const variationAttributeSchema = z
  .object({
    attribute: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(200),
  })
  .strict();

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
        message: "A variação está incompleta.",
      });
    }
  });

const cartItemKeySchema = z
  .object({
    key: z.string().trim().min(1).max(100),
  })
  .strict();

function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0
    ? value
    : undefined;
}

export async function POST(request: Request) {
  const cartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;
  const body = await request.json().catch(() => null);
  const parsedInput = addCartItemSchema.safeParse(body);

  if (!parsedInput.success) {
    return createCartErrorResponse(
      "Produto ou quantidade inválidos.",
      400,
      cartToken,
    );
  }

  const input = parsedInput.data;

  try {
    const result = await addItemToCart(
      {
        productId: input.variationId ?? input.productId,
        quantity: input.quantity,
        variation: input.variation,
      },
      cartToken,
    );
    return createCartResponse(result.cart, result.cartToken);
  } catch (error) {
    const status = error instanceof CartServiceError ? error.status : 500;
    const unavailable = status === 400 || status === 409;

    return createCartErrorResponse(
      unavailable
        ? "Este produto não está disponível no momento."
        : "Não foi possível adicionar o produto. Tente novamente.",
      status,
      cartToken,
    );
  }
}

export async function DELETE(request: Request) {
  const cartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;

  if (!cartToken) {
    return createCartErrorResponse("Carrinho não encontrado.", 404);
  }

  const body = await request.json().catch(() => null);
  const parsedInput = cartItemKeySchema.safeParse(body);

  if (!parsedInput.success) {
    return createCartErrorResponse("Item inválido.", 400, cartToken);
  }

  try {
    const result = await removeCartItem(parsedInput.data.key, cartToken);
    return createCartResponse(result.cart, result.cartToken);
  } catch (error) {
    const status = error instanceof CartServiceError ? error.status : 500;

    return createCartErrorResponse(
      status === 400 || status === 404 || status === 409
        ? "Este item não está mais no carrinho."
        : "Não foi possível remover o item. Tente novamente.",
      status,
      cartToken,
    );
  }
}

export async function PATCH(request: Request) {
  const cartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return createCartErrorResponse("Dados inválidos.", 400, cartToken);
  }

  const input = body as Record<string, unknown>;
  const key = typeof input.key === "string" ? input.key.trim() : "";
  const quantity = parsePositiveInteger(input.quantity);

  if (!key || !quantity || quantity > MAX_CART_QUANTITY) {
    return createCartErrorResponse(
      "Item ou quantidade inválidos.",
      400,
      cartToken,
    );
  }

  if (!cartToken) {
    return createCartErrorResponse("Carrinho não encontrado.", 404);
  }

  try {
    const result = await updateCartItem(key, quantity, cartToken);
    return createCartResponse(result.cart, result.cartToken);
  } catch (error) {
    const status = error instanceof CartServiceError ? error.status : 500;

    if (status === 400 || status === 409) {
      try {
        const current = await getCart(cartToken);
        const item = current.cart.items.find((cartItem) => cartItem.key === key);
        const availableMaximum = item?.maxQuantity;

        if (
          item &&
          availableMaximum !== undefined &&
          availableMaximum >= item.minQuantity &&
          availableMaximum < quantity
        ) {
          if (item.quantity !== availableMaximum) {
            const adjusted = await updateCartItem(key, availableMaximum, cartToken);
            return createCartResponse(adjusted.cart, adjusted.cartToken);
          }
          return createCartResponse(current.cart, current.cartToken);
        }
      } catch {
        // Mantém abaixo a resposta segura original quando não for possível
        // obter ou aplicar o limite autoritativo informado pelo WooCommerce.
      }
    }

    return createCartErrorResponse(
      status === 400 || status === 409
        ? "A quantidade solicitada não está disponível."
        : "Não foi possível atualizar o carrinho. Tente novamente.",
      status,
      cartToken,
    );
  }
}
