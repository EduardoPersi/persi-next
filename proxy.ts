import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
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

const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/mfa", "/admin/auth/callback", "/admin/access-denied"];
async function validateAdminSession(request: NextRequest) {
  const response = NextResponse.next({ request });
  const url = process.env.ADMIN_SUPABASE_URL;
  const key = process.env.ADMIN_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { valid: false, response };
  const client = createServerClient(url, key, {
    cookieOptions: { name: "persi_admin_session", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, headers) {
        values.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, { ...options, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
        });
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });
  try {
    const { data, error } = await client.auth.getClaims();
    return { valid: !error && Boolean(data?.claims?.sub), response };
  } catch { return { valid: false, response }; }
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (PUBLIC_ADMIN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      const response = NextResponse.next();
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    const admin = await validateAdminSession(request);
    if (!admin.valid) return NextResponse.redirect(new URL(`/admin/login?next=${encodeURIComponent(pathname)}`, request.url));
    admin.response.headers.set("Cache-Control", "private, no-store");
    return admin.response;
  }
  if (!isPrivateAuthPath(pathname) && !isPublicAuthPath(pathname)) return NextResponse.next();
  const authenticated = await hasValidJwt(request);
  const redirectPath = getAuthRedirect({ pathname, authenticated });
  if (!redirectPath) return NextResponse.next();

  const response = NextResponse.redirect(new URL(redirectPath, request.url));
  if (!authenticated) response.cookies.set(AUTH_COOKIE_NAME, "", getExpiredAuthCookieOptions());
  return response;
}

export const config = {
  matcher: ["/entrar", "/minha-conta/:path*", "/admin/:path*"],
};
