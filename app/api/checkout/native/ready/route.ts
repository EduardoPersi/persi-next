import { NextResponse } from "next/server";
import { handleMarkNativeCheckoutReady, markReadyInputSchema } from "@/lib/commerce/nativeCheckoutPrepHandlers";
import { nativeCheckoutPrepRateLimiter } from "@/lib/commerce/nativeCommerceRequestGuards";
import {
  originGuardResponse,
  rateLimitResponse,
  resolveGuestOwner,
  stagingGateResponse,
  toCheckoutRouteResponse,
} from "@/lib/commerce/nativeCommerceRouteWiring";

// Gate 3 -- marks a checkout session ready for submission, once PII has
// been persisted. This is the last new route in the Gate 3 slice: the
// actual submission (app/api/checkout/native/route.ts) already exists and
// is untouched -- it stays behind isNativeCheckoutRuntimeEnabled(), which
// this whole round never enables.
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
  const parsed = markReadyInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ code: "INVALID_REQUEST", message: "Dados inválidos." }, { status: 400 });
  }

  const result = await handleMarkNativeCheckoutReady(owner, parsed.data);
  return toCheckoutRouteResponse(result);
}
