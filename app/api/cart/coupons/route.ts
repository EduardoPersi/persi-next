import { cookies } from "next/headers";
import { z } from "zod";
import {
  applyCartCoupon,
  CartServiceError,
  removeCartCoupon,
} from "@/services/woocommerce/cart";
import {
  CART_TOKEN_COOKIE,
  createCartErrorResponse,
  createCartResponse,
} from "../cart-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const couponSchema = z.object({ code: z.string().trim().min(1).max(64) }).strict();

async function mutate(request: Request, action: "apply" | "remove") {
  const cartToken = (await cookies()).get(CART_TOKEN_COOKIE)?.value;
  if (!cartToken) return createCartErrorResponse("Carrinho não encontrado.", 404);

  const parsed = couponSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return createCartErrorResponse("Informe um cupom válido.", 400, cartToken);
  }

  try {
    const result = action === "apply"
      ? await applyCartCoupon(parsed.data.code, cartToken)
      : await removeCartCoupon(parsed.data.code, cartToken);
    return createCartResponse(result.cart, result.cartToken);
  } catch (error) {
    const status = error instanceof CartServiceError ? error.status : 500;
    return createCartErrorResponse(
      action === "apply"
        ? "O WooCommerce não aceitou este cupom."
        : "Não foi possível remover o cupom.",
      status,
      cartToken,
    );
  }
}

export async function POST(request: Request) {
  return mutate(request, "apply");
}

export async function DELETE(request: Request) {
  return mutate(request, "remove");
}
