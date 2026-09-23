import { NextResponse } from "next/server";
import { handlePrepareNativeCheckout, prepareCheckoutInputSchema } from "@/lib/commerce/nativeCheckoutPrepHandlers";
import { nativeCheckoutPrepRateLimiter } from "@/lib/commerce/nativeCommerceRequestGuards";
import {
  originGuardResponse,
  rateLimitResponse,
  resolveGuestOwner,
  stagingGateResponse,
  toCheckoutRouteResponse,
} from "@/lib/commerce/nativeCommerceRouteWiring";

// Gate 3 -- prepares a checkout session from an existing cart. This phase
// only supports shippingRequired: false (see the file-level comment in
// nativeCheckoutPrepHandlers.ts for the disclosed reason); the request
// schema itself enforces that via z.literal(false), so a client cannot
// smuggle a different value in.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(request: Request) {
  const gate = stagingGateResponse();
  if (gate) return gate;

  const origin = originGuardResponse(request);
  if (origin) return origin;

  const limited = rateLimitResponse(request, nativeCheckoutPrepRateLimiter);
  if (limited) return limited;

  const owner = resolveGuestOwner(request);
  if (!owner.guestToken) {
    return NextResponse.json({ code: "CART_NOT_FOUND", message: "Carrinho não encontrado." }, { status: 404 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = prepareCheckoutInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ code: "INVALID_REQUEST", message: "Dados inválidos." }, { status: 400 });
  }

  const result = await handlePrepareNativeCheckout(owner, parsed.data);
  return toCheckoutRouteResponse(result);
}
