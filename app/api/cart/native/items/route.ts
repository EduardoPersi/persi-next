import { NextResponse } from "next/server";
import { z } from "zod";
import { addCartItemInputSchema, handleAddNativeCartItem } from "@/lib/commerce/nativeCartHandlers";
import { nativeCartMutationRateLimiter } from "@/lib/commerce/nativeCommerceRequestGuards";
import {
  originGuardResponse,
  rateLimitResponse,
  resolveGuestOwner,
  stagingGateResponse,
  toCartRouteResponse,
} from "@/lib/commerce/nativeCommerceRouteWiring";

// Gate 3 -- add an item to an existing cart. cartId is accepted in the
// body (there is no /cart/native/[cartId] path segment: this round has no
// customer-account UI that would need to address a cart by id outside its
// own cookie-scoped session). Ownership is NOT re-checked at this layer --
// add_native_cart_item itself takes the caller's own guestFingerprint/
// customerId and raises CART_OWNERSHIP_INVALID (mapped to 403 by
// mapCartError) if it doesn't match the cart's actual owner, the same as
// update/remove below. A cookie alone is never sufficient authorization by
// itself; it only supplies the identity the database then verifies.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(request: Request) {
  const gate = stagingGateResponse();
  if (gate) return gate;

  const origin = originGuardResponse(request);
  if (origin) return origin;

  const limited = rateLimitResponse(request, nativeCartMutationRateLimiter);
  if (limited) return limited;

  const owner = resolveGuestOwner(request);
  if (!owner.guestToken) {
    return NextResponse.json({ code: "CART_NOT_FOUND", message: "Carrinho não encontrado." }, { status: 404 });
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object") {
    return NextResponse.json({ code: "INVALID_REQUEST", message: "Dados inválidos." }, { status: 400 });
  }
  const { cartId, ...rest } = rawBody as Record<string, unknown>;
  const cartIdResult = z.uuid().safeParse(cartId);
  const inputResult = addCartItemInputSchema.safeParse(rest);
  if (!cartIdResult.success || !inputResult.success) {
    return NextResponse.json({ code: "INVALID_REQUEST", message: "Dados inválidos." }, { status: 400 });
  }

  const result = await handleAddNativeCartItem(cartIdResult.data, owner, inputResult.data);
  return toCartRouteResponse(result);
}
