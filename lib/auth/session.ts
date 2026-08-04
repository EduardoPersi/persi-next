import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME } from "./cookies.ts";
import { validateJwt } from "./jwt.ts";
import { isJwtFormat } from "./token.ts";
import type { AuthSession } from "./types.ts";
import { getAuthenticatedUser } from "./user.ts";

export async function getJwtFromCookie(): Promise<string | null> {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value ?? "";
  return isJwtFormat(token) ? token : null;
}

export async function getAuthenticatedSession(): Promise<AuthSession> {
  const token = await getJwtFromCookie();
  if (!token || !(await validateJwt(token))) return { authenticated: false };

  const user = await getAuthenticatedUser(token);
  return {
    authenticated: true,
    expiresAt: null,
    user,
  };
}
