import "server-only";

// Gate 3 -- dedicated cookie for the NATIVE guest cart token, separate
// from the existing WooCommerce cart cookie (they are two different
// carts and must never be confused). Kept as plain, framework-agnostic
// constants/options here; the actual Next.js cookie get/set calls live in
// the route.ts files (which import next/server and so can't be
// unit-tested directly -- see this codebase's own established convention
// for route files).

export const NATIVE_CART_COOKIE_NAME = "persi_native_cart_token";

// 30 days, matching this project's general expectation for how long a
// cart should be expected to survive across visits (to be reconciled with
// whatever the existing WooCommerce cart cookie actually uses, if that
// differs -- not verified in this round, see design doc).
export const NATIVE_CART_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function nativeCartCookieOptions(): {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: NATIVE_CART_COOKIE_MAX_AGE_SECONDS,
  };
}
