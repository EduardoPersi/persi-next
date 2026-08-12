import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, getExpiredAuthCookieOptions } from "@/lib/auth/cookies";
import { getAuthRedirect, isPrivateAuthPath, isPublicAuthPath } from "@/lib/auth/middleware";

async function hasValidJwt(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const wordpressUrl = process.env.WORDPRESS_URL?.replace(/\/$/, "");
  if (!token || !wordpressUrl) return false;
  try {
    const response = await fetch(`${wordpressUrl}/wp-json/jwt-auth/v1/token/validate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!isPrivateAuthPath(pathname) && !isPublicAuthPath(pathname)) return NextResponse.next();
  const authenticated = await hasValidJwt(request);
  const redirectPath = getAuthRedirect({ pathname, authenticated });
  if (!redirectPath) return NextResponse.next();

  const response = NextResponse.redirect(new URL(redirectPath, request.url));
  if (!authenticated) response.cookies.set(AUTH_COOKIE_NAME, "", getExpiredAuthCookieOptions());
  return response;
}

export const config = {
  matcher: ["/entrar", "/minha-conta/:path*"],
};
