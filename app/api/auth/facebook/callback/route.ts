import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getFacebookOAuthConfig,
  getFacebookOAuthErrorOrigin,
} from "@/lib/account/oauth/facebook";
import {
  clearOAuthTransactionCookies,
  getOAuthCookieNames,
} from "@/lib/account/oauth/cookies";
import { getOAuthProvider } from "@/lib/account/oauth/provider";
import { createOAuthRedirect } from "@/lib/account/oauth/redirect";
import {
  ACCOUNT_SESSION_COOKIE,
  getAccountSessionCookieOptions,
  getExpiredAccountSessionCookieOptions,
  replaceOAuthAccountSession,
} from "@/lib/account/oauth/session";
import { validateOAuthCallbackInput } from "@/lib/account/oauth/state";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function clearTemporaryCookies(response: NextResponse) {
  clearOAuthTransactionCookies(
    response,
    "facebook",
    process.env.NODE_ENV === "production",
  );
}

export async function GET(request: Request) {
  let origin = getFacebookOAuthErrorOrigin();
  let previousSessionToken = "";
  try {
    const config = getFacebookOAuthConfig();
    origin = new URL(config.redirectUri).origin;
    const url = new URL(request.url);
    if (url.searchParams.get("error") === "access_denied") {
      const response = createOAuthRedirect(
        origin,
        "/entrar?erro=facebook_cancelado",
      );
      clearTemporaryCookies(response);
      return response;
    }

    const cookieStore = await cookies();
    const names = getOAuthCookieNames("facebook");
    previousSessionToken =
      cookieStore.get(ACCOUNT_SESSION_COOKIE)?.value ?? "";
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const nonce = cookieStore.get(names.nonce)?.value ?? "";
    const codeVerifier = cookieStore.get(names.verifier)?.value ?? "";
    validateOAuthCallbackInput({
      code,
      codeVerifier,
      expectedState: cookieStore.get(names.state)?.value ?? "",
      nonce,
      state,
    });

    const provider = getOAuthProvider("facebook");
    const token = await provider.exchangeCode({
      code,
      codeVerifier,
      config,
    });
    const providerUser = await provider.getUser(token, { config, nonce });
    const identity = provider.normalizeUser(providerUser);
    const accountSession = await replaceOAuthAccountSession(
      identity,
      previousSessionToken,
    );
    if (accountSession.sessionToken === previousSessionToken) {
      throw new Error("OAuth account session token was reused");
    }

    const response = createOAuthRedirect(origin, "/minha-conta");
    clearTemporaryCookies(response);
    response.cookies.set(
      ACCOUNT_SESSION_COOKIE,
      accountSession.sessionToken,
      getAccountSessionCookieOptions({
        isProduction: process.env.NODE_ENV === "production",
        remember: false,
        expiresAt: accountSession.expiresAt,
      }),
    );
    return response;
  } catch {
    const response = createOAuthRedirect(origin, "/entrar?erro=facebook");
    clearTemporaryCookies(response);
    if (/^[A-Za-z0-9_-]{43}$/.test(previousSessionToken)) {
      response.cookies.set(
        ACCOUNT_SESSION_COOKIE,
        "",
        getExpiredAccountSessionCookieOptions(
          process.env.NODE_ENV === "production",
        ),
      );
    }
    return response;
  }
}
