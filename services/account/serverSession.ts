import { getJwtFromCookie, getAuthenticatedSession } from "@/lib/auth/session";
import type { AccountSession } from "@/lib/account/validation";

export async function getServerAccountToken(): Promise<string | null> {
  return getJwtFromCookie();
}

export async function getServerAccountSession(): Promise<AccountSession | null> {
  try {
    const session = await getAuthenticatedSession();
    if (!session.authenticated) return null;
    return {
      authenticated: true,
      expiresAt: session.expiresAt,
      customer: {
        id: session.user.id,
        firstName: session.user.firstName,
        displayName: session.user.displayName,
        email: session.user.email,
        roles: session.user.roles,
        avatar: session.user.avatar,
        permissions: session.user.permissions,
        authenticated: true,
        jwtExpiration: session.expiresAt,
      },
    };
  } catch {
    return null;
  }
}
