import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, getExpiredAuthCookieOptions } from "@/lib/auth/cookies";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const session = await getAuthenticatedSession();
    if (!session.authenticated) {
      const response = NextResponse.json(session, { headers: getPrivateAccountHeaders() });
      response.cookies.set(AUTH_COOKIE_NAME, "", getExpiredAuthCookieOptions());
      return response;
    }
    return NextResponse.json(
      { authenticated: true, expiresAt: session.expiresAt, customer: { id: session.user.id, firstName: session.user.firstName, displayName: session.user.displayName, email: session.user.email, roles: session.user.roles, avatar: session.user.avatar, permissions: session.user.permissions, authenticated: true, jwtExpiration: session.expiresAt } },
      { headers: getPrivateAccountHeaders() },
    );
  } catch {
    const response = NextResponse.json({ authenticated: false }, { headers: getPrivateAccountHeaders() });
    response.cookies.set(AUTH_COOKIE_NAME, "", getExpiredAuthCookieOptions());
    return response;
  }
}
