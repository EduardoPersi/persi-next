import type { NextResponse } from "next/server";
import type {
  OAuthProviderName,
  OAuthTransaction,
} from "./types.ts";

export const OAUTH_COOKIE_MAX_AGE = 10 * 60;

const COOKIE_NAMES = {
  google: {
    state: "persi_google_oauth_state",
    nonce: "persi_google_oauth_nonce",
    verifier: "persi_google_oauth_verifier",
  },
  facebook: {
    state: "persi_facebook_oauth_state",
    nonce: "persi_facebook_oauth_nonce",
    verifier: "persi_facebook_oauth_verifier",
  },
} as const;

export const GOOGLE_ONE_TAP_NONCE_COOKIE = "persi_google_onetap_nonce";
export const GOOGLE_ONE_TAP_NONCE_MAX_AGE = 5 * 60;

export function getGoogleOneTapNonceCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/api/auth/google/one-tap",
    maxAge: GOOGLE_ONE_TAP_NONCE_MAX_AGE,
  };
}

type ConfiguredOAuthProvider = keyof typeof COOKIE_NAMES;

export function getOAuthCookieNames(
  provider: ConfiguredOAuthProvider,
) {
  return COOKIE_NAMES[provider];
}

export function getOAuthCookieOptions(
  provider: OAuthProviderName,
  isProduction: boolean,
) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: `/api/auth/${provider}`,
    maxAge: OAUTH_COOKIE_MAX_AGE,
  };
}

export function setOAuthTransactionCookies(
  response: NextResponse,
  provider: ConfiguredOAuthProvider,
  transaction: OAuthTransaction,
  isProduction: boolean,
): void {
  const names = getOAuthCookieNames(provider);
  const options = getOAuthCookieOptions(provider, isProduction);
  response.cookies.set(names.state, transaction.state, options);
  response.cookies.set(names.nonce, transaction.nonce, options);
  response.cookies.set(
    names.verifier,
    transaction.codeVerifier,
    options,
  );
}

export function clearOAuthTransactionCookies(
  response: NextResponse,
  provider: ConfiguredOAuthProvider,
  isProduction: boolean,
): void {
  const names = getOAuthCookieNames(provider);
  const options = getOAuthCookieOptions(provider, isProduction);

  for (const name of [names.state, names.nonce, names.verifier]) {
    response.cookies.set(name, "", { ...options, maxAge: 0 });
  }
}
