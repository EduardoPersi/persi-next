import "server-only";

import { NextResponse } from "next/server";
import { isNativeCommerceStagingRoutesEnabled } from "@/lib/runtime/native-commerce-staging-routes";
import { NATIVE_CART_COOKIE_NAME, nativeCartCookieOptions } from "./nativeCartCookie";
import { isSameOriginRequest } from "./nativeCommerceRequestGuards";
import type { HandlerResult as CartHandlerResult } from "./nativeCartHandlers";
import type { HandlerResult as CheckoutHandlerResult } from "./nativeCheckoutPrepHandlers";

// Gate 3 -- thin, untested-by-design wiring shared by every new route.ts
// under app/api/cart/native and app/api/checkout/native/{prepare,pii,ready}.
// This file intentionally imports "next/server" (unlike every *Handlers.ts
// module it sits in front of) -- this codebase's own established
// convention is that route.ts and its direct next/server-dependent wiring
// cannot be unit-tested under the plain Node test runner, so all business
// logic already lives one layer down, in the *Handlers.ts modules, which
// this file only calls into. Keeping that logic out of here is what makes
// it testable at all.

export function stagingGateResponse(): NextResponse | null {
  if (isNativeCommerceStagingRoutesEnabled()) return null;
  // 404, not 503/403: while disabled, this surface must look like it does
  // not exist at all -- no hint to a scanner that a staging-only feature
  // is merely gated off (design point (e)).
  return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
}

export function originGuardResponse(request: Request): NextResponse | null {
  if (isSameOriginRequest(request)) return null;
  return NextResponse.json({ code: "ORIGIN_REJECTED", message: "Origem não permitida." }, { status: 403 });
}

export function rateLimitResponse(request: Request, limiter: { isLimited(headers: Headers): boolean }): NextResponse | null {
  if (!limiter.isLimited(request.headers)) return null;
  return NextResponse.json({ code: "RATE_LIMITED", message: "Muitas requisições. Tente novamente em instantes." }, { status: 429 });
}

export function readGuestCartTokenFromCookies(request: Request): string | null {
  // Route Handlers may read the incoming cookie directly off the Request
  // (no need for next/headers' cookies() helper, which is for Server
  // Components/Actions) -- same approach as this app's other route.ts
  // files that parse Cookie headers manually elsewhere.
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === NATIVE_CART_COOKIE_NAME) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

// Owner resolution is guest-token-only for this round, matching the
// existing final-submission route's own documented precedent
// (app/api/checkout/native/route.ts point 2): no resolver from an
// authenticated WooCommerce/account session to a native `customers` row
// exists anywhere in this codebase yet. Inventing one here would be an
// unrequested addition; a future round wiring authenticated checkout
// should extend this function, not the routes that call it.
export function resolveGuestOwner(request: Request): { customerId: null; guestToken: string | null } {
  return { customerId: null, guestToken: readGuestCartTokenFromCookies(request) };
}

export function toCartRouteResponse<T>(result: CartHandlerResult<T>): NextResponse {
  if (!result.ok) {
    return NextResponse.json({ code: result.code, message: result.message }, { status: result.status });
  }
  const response = NextResponse.json(result.data, { status: result.status });
  if (result.setGuestToken) {
    response.cookies.set(NATIVE_CART_COOKIE_NAME, result.setGuestToken, nativeCartCookieOptions());
  }
  return response;
}

export function toCheckoutRouteResponse<T>(result: CheckoutHandlerResult<T>): NextResponse {
  if (!result.ok) {
    return NextResponse.json({ code: result.code, message: result.message }, { status: result.status });
  }
  return NextResponse.json(result.data, { status: result.status });
}
