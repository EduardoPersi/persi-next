export const CART_CACHE_CONTROL =
  "private, no-store, no-cache, must-revalidate, max-age=0";

export function getPrivateCartHeaders(): Record<string, string> {
  return {
    "Cache-Control": CART_CACHE_CONTROL,
    Pragma: "no-cache",
    Expires: "0",
    Vary: "Cookie",
  };
}

export function getCartTokenCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}
