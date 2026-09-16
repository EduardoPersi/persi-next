import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE_NAME, getExpiredAuthCookieOptions } from "@/lib/auth/cookies";
import { getAuthRedirect, isPrivateAuthPath, isPublicAuthPath } from "@/lib/auth/middleware";
import { isStagingRuntime } from "@/lib/runtime/runtime-environment";
import { isStagingBasicAuthValid } from "@/lib/runtime/staging-access-guard";

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

// A3.6-D1.6 Section 22/23: local fallback access protection, active ONLY
// when PERSI_RUNTIME_ENV=staging (never today's production, which has no
// such variable set -- isStagingRuntime() is false there, so this whole
// branch is skipped and production behavior below is unchanged). Runs
// before every other check for a staging deploy, on every path the
// broadened matcher now covers. Fail-closed: missing configured
// credentials denies access (see staging-access-guard.ts), it never opens
// staging publicly "by accident".
function stagingAccessDeniedResponse(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="staging"' },
  });
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isStagingRuntime()) {
    // No health-check path is exempted: no evidence of an existing generic
    // health endpoint that would need bypassing Basic Auth (a specific
    // checkout-auth health route exists but is unrelated to uptime
    // monitoring). A future provisioning round can add a narrowly-scoped
    // exemption if a real monitor requires one -- not guessed here.
    if (!isStagingBasicAuthValid(request.headers.get("authorization"))) {
      return stagingAccessDeniedResponse();
    }
  }

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

// A3.6-D1.6: matcher broadened from ["/entrar", "/minha-conta/:path*",
// "/admin/:path*"] to cover the whole site (excluding Next.js' own static
// asset internals) so the staging Basic Auth gate above can actually
// protect every route, not just auth/admin ones. This adds one cheap,
// synchronous isStagingRuntime() check per request in EVERY environment;
// production's behavior for every path outside the original three patterns
// is unchanged -- the function falls through to `if (!isPrivateAuthPath...)
// return NextResponse.next()` exactly as it would have if the proxy had
// never run for that path at all.
export const config = {
  // The broad pattern alone already covers /admin/:path* and the other two
  // original entries; /admin/:path* is kept explicitly alongside it only
  // because tests/pimAdminSecurity.test.mjs asserts on that literal string
  // as documentation that admin defense-in-depth coverage is intentional,
  // not incidental -- redundant for matching purposes, harmless to keep.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)", "/admin/:path*"],
};
