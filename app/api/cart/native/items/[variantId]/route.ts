import { NextResponse } from "next/server";
import { z } from "zod";
import {
  handleRemoveNativeCartItem,
  handleUpdateNativeCartItem,
  removeCartItemInputSchema,
  updateCartItemInputSchema,
} from "@/lib/commerce/nativeCartHandlers";
import { nativeCartMutationRateLimiter } from "@/lib/commerce/nativeCommerceRequestGuards";
import {
  originGuardResponse,
  rateLimitResponse,
  resolveGuestOwner,
  stagingGateResponse,
  toCartRouteResponse,
} from "@/lib/commerce/nativeCommerceRouteWiring";

// Gate 3 -- update/remove a single line item, identified by product
// variant id in the path. cartId is still required in the body (same
// reasoning as items/route.ts: this cookie-scoped session has exactly one
// active cart, but the cart id itself is not derived from the cookie --
// only the owner identity is -- so the caller must state which cart, and
// ownership is verified at the database layer, not assumed from the path).
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function requireOwnerAndVariant(request: Request, params: { variantId: string }) {
  const owner = resolveGuestOwner(request);
  const variantId = z.uuid().safeParse(params.variantId);
  return { owner, variantId };
}

export async function PATCH(request: Request, context: { params: Promise<{ variantId: string }> }) {
  const gate = stagingGateResponse();
  if (gate) return gate;

  const origin = originGuardResponse(request);
  if (origin) return origin;

  const limited = rateLimitResponse(request, nativeCartMutationRateLimiter);
  if (limited) return limited;

  const params = await context.params;
  const { owner, variantId } = requireOwnerAndVariant(request, params);
  if (!owner.guestToken || !variantId.success) {
    return NextResponse.json({ code: "CART_ITEM_NOT_FOUND", message: "Item não encontrado no carrinho." }, { status: 404 });
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object") {
    return NextResponse.json({ code: "INVALID_REQUEST", message: "Dados inválidos." }, { status: 400 });
  }
  const { cartId, ...rest } = rawBody as Record<string, unknown>;
  const cartIdResult = z.uuid().safeParse(cartId);
  const inputResult = updateCartItemInputSchema.safeParse(rest);
  if (!cartIdResult.success || !inputResult.success) {
    return NextResponse.json({ code: "INVALID_REQUEST", message: "Dados inválidos." }, { status: 400 });
  }

  const result = await handleUpdateNativeCartItem(cartIdResult.data, variantId.data, owner, inputResult.data);
  return toCartRouteResponse(result);
}

export async function DELETE(request: Request, context: { params: Promise<{ variantId: string }> }) {
  const gate = stagingGateResponse();
  if (gate) return gate;

  const origin = originGuardResponse(request);
  if (origin) return origin;

  const limited = rateLimitResponse(request, nativeCartMutationRateLimiter);
  if (limited) return limited;

  const params = await context.params;
  const { owner, variantId } = requireOwnerAndVariant(request, params);
  if (!owner.guestToken || !variantId.success) {
    return NextResponse.json({ code: "CART_ITEM_NOT_FOUND", message: "Item não encontrado no carrinho." }, { status: 404 });
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object") {
    return NextResponse.json({ code: "INVALID_REQUEST", message: "Dados inválidos." }, { status: 400 });
  }
  const { cartId, ...rest } = rawBody as Record<string, unknown>;
  const cartIdResult = z.uuid().safeParse(cartId);
  const inputResult = removeCartItemInputSchema.safeParse(rest);
  if (!cartIdResult.success || !inputResult.success) {
    return NextResponse.json({ code: "INVALID_REQUEST", message: "Dados inválidos." }, { status: 400 });
  }

  const result = await handleRemoveNativeCartItem(cartIdResult.data, variantId.data, owner, inputResult.data);
  return toCartRouteResponse(result);
}
