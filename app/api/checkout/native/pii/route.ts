import { NextResponse } from "next/server";
import { handlePersistNativeCheckoutPii, persistPiiInputSchema } from "@/lib/commerce/nativeCheckoutPrepHandlers";
import { nativeCheckoutPrepRateLimiter } from "@/lib/commerce/nativeCommerceRequestGuards";
import {
  originGuardResponse,
  rateLimitResponse,
  resolveGuestOwner,
  stagingGateResponse,
  toCheckoutRouteResponse,
} from "@/lib/commerce/nativeCommerceRouteWiring";

// Gate 3 -- persists contact/address PII for an already-prepared checkout
// session. Never log the request body or response body of this route:
// input.pii and everything persistNativeCheckoutPii/handlePersistNativeCheckoutPii
// derive from it are exactly the fields this route exists to protect.
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
    return NextResponse.json({ code: "OWNER_CONTEXT_INVALID", message: "Dados de identificação inválidos." }, { status: 422 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = persistPiiInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ code: "INVALID_REQUEST", message: "Dados inválidos." }, { status: 400 });
  }

  const result = await handlePersistNativeCheckoutPii(owner, parsed.data);
  return toCheckoutRouteResponse(result);
}
