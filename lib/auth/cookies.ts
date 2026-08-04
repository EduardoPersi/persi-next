export const AUTH_COOKIE_NAME = "__Host-persi_jwt_session";

const baseCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  priority: "high" as const,
};

export function getAuthCookieOptions(expiresAt: string) {
  const expires = new Date(expiresAt);
  return {
    ...baseCookieOptions,
    expires,
  };
}

export function getExpiredAuthCookieOptions() {
  return {
    ...baseCookieOptions,
    expires: new Date(0),
    maxAge: 0,
  };
}
