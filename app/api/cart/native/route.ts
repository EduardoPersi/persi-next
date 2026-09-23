import {
  handleCreateOrGetNativeCart,
  handleGetNativeCart,
} from "@/lib/commerce/nativeCartHandlers";
import { nativeCartMutationRateLimiter } from "@/lib/commerce/nativeCommerceRequestGuards";
import {
  originGuardResponse,
  rateLimitResponse,
  resolveGuestOwner,
  stagingGateResponse,
  toCartRouteResponse,
} from "@/lib/commerce/nativeCommerceRouteWiring";

// Gate 3 -- native cart entrypoint (staging-only; see
// docs/native-commerce/gate3-native-cart-checkout-routes.md). GET never
// creates a cart (matches handleGetNativeCart); POST is the only
// create-or-get entrypoint. Both are gated 404 while
// isNativeCommerceStagingRoutesEnabled() is false, independent of
// isNativeCheckoutRuntimeEnabled (untouched by this file).
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(request: Request) {
  const gate = stagingGateResponse();
  if (gate) return gate;

  const owner = resolveGuestOwner(request);
  const result = await handleGetNativeCart(owner);
  return toCartRouteResponse(result);
}

export async function POST(request: Request) {
  const gate = stagingGateResponse();
  if (gate) return gate;

  const origin = originGuardResponse(request);
  if (origin) return origin;

  const limited = rateLimitResponse(request, nativeCartMutationRateLimiter);
  if (limited) return limited;

  const owner = resolveGuestOwner(request);
  const result = await handleCreateOrGetNativeCart(owner);
  return toCartRouteResponse(result);
}
