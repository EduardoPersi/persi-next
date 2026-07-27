export const ACCOUNT_CACHE_CONTROL =
  "private, no-store, no-cache, max-age=0";

export function getPrivateAccountHeaders(): Record<string, string> {
  return {
    "Cache-Control": ACCOUNT_CACHE_CONTROL,
    Pragma: "no-cache",
    Expires: "0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Cookie",
  };
}
