import type { NormalizedOAuthUser } from "./types.ts";
import {
  ACCOUNT_SESSION_COOKIE,
  getAccountSessionCookieOptions,
  getExpiredAccountSessionCookieOptions,
} from "../sessionCookie.ts";
import {
  getAccountSession,
  logoutAccount,
} from "../../../services/account/auth.ts";
import {
  createOAuthAccountSession as createAccountSession,
  type OAuthAccountSession,
} from "../../../services/account/oauthAuth.ts";

export {
  ACCOUNT_SESSION_COOKIE,
  getAccountSessionCookieOptions,
  getExpiredAccountSessionCookieOptions,
};

export async function createOAuthAccountSession(
  identity: NormalizedOAuthUser,
): Promise<OAuthAccountSession> {
  return createAccountSession(identity);
}

export async function readOAuthAccountSession(sessionToken: string) {
  return getAccountSession(sessionToken);
}

export async function renewOAuthAccountSession(sessionToken: string) {
  return getAccountSession(sessionToken);
}

export async function destroyOAuthAccountSession(
  sessionToken: string,
): Promise<void> {
  await logoutAccount(sessionToken);
}

export async function replaceOAuthAccountSession(
  identity: NormalizedOAuthUser,
  previousSessionToken: string,
): Promise<OAuthAccountSession> {
  if (/^[A-Za-z0-9_-]{43}$/.test(previousSessionToken)) {
    await destroyOAuthAccountSession(previousSessionToken);
  }
  return createOAuthAccountSession(identity);
}
