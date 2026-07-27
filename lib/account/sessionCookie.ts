export const ACCOUNT_SESSION_COOKIE = "__Host-persi_account_session";

export function getAccountSessionCookieOptions(input: {
  isProduction: boolean;
  remember?: boolean;
  expiresAt?: string;
}) {
  const expires =
    input.remember && input.expiresAt
      ? new Date(input.expiresAt)
      : undefined;

  return {
    httpOnly: true,
    secure: input.isProduction,
    sameSite: "lax" as const,
    path: "/",
    ...(expires && Number.isFinite(expires.getTime()) ? { expires } : {}),
  };
}

export function getExpiredAccountSessionCookieOptions(isProduction: boolean) {
  return {
    ...getAccountSessionCookieOptions({ isProduction }),
    expires: new Date(0),
    maxAge: 0,
  };
}
