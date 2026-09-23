import "server-only";

import { createRateLimiter } from "@/lib/network/rateLimit";

// Gate 3 -- Origin/Referer check for the new mutation routes. No existing
// route in this codebase has a dedicated helper for this (confirmed by
// search); the legacy Woo cart routes rely only on same-origin fetch
// convention from this app's own frontend. Fail-closed: APP_BASE_URL
// unset, an unparseable APP_BASE_URL/Origin/Referer, or the header simply
// absent, are all treated as "not same-origin" -- never permissive by
// default.
export function isSameOriginRequest(request: Request): boolean {
  const appBaseUrl = process.env.APP_BASE_URL?.trim();
  if (!appBaseUrl) return false;

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(appBaseUrl).origin;
  } catch {
    return false;
  }

  const origin = request.headers.get("origin");
  if (origin) return origin === expectedOrigin;

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  return false;
}

// One instance per mutation surface, reusing the same createRateLimiter
// already used elsewhere (lib/network/rateLimit.ts) -- IP-keyed, in-memory,
// process-local (matches this app's single persistent Hostinger process).
export const nativeCartMutationRateLimiter = createRateLimiter(60_000, 60);
export const nativeCheckoutPrepRateLimiter = createRateLimiter(60_000, 20);
