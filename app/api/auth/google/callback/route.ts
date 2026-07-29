import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  exchangeGoogleAuthorizationCode,
  getGoogleOAuthConfig,
  getGoogleOAuthCookieOptions,
  getGoogleOAuthErrorOrigin,
  validateGoogleOAuthCallbackInput,
  validateGoogleIdToken,
  GOOGLE_OAUTH_NONCE_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_VERIFIER_COOKIE,
} from "@/lib/account/googleOAuth";
import {
  ACCOUNT_SESSION_COOKIE,
  getAccountSessionCookieOptions,
} from "@/lib/account/sessionCookie";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import { createGoogleAccountSession } from "@/services/account/googleAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const GOOGLE_ERROR_PATH = "/entrar?erro=google";

function clearTemporaryCookies(response: NextResponse) {
  const options = getGoogleOAuthCookieOptions(
    process.env.NODE_ENV === "production",
  );
  for (const name of [
    GOOGLE_OAUTH_STATE_COOKIE,
    GOOGLE_OAUTH_NONCE_COOKIE,
    GOOGLE_OAUTH_VERIFIER_COOKIE,
  ]) {
    response.cookies.set(name, "", { ...options, maxAge: 0 });
  }
}

function redirectResponse(origin: string, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, origin), {
    headers: getPrivateAccountHeaders(),
  });
}

export async function GET(request: Request) {
  let origin = getGoogleOAuthErrorOrigin();
  try {
    const config = getGoogleOAuthConfig();
    origin = new URL(config.redirectUri).origin;
    const url = new URL(request.url);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const cookieStore = await cookies();
    const expectedState =
      cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value ?? "";
    const nonce = cookieStore.get(GOOGLE_OAUTH_NONCE_COOKIE)?.value ?? "";
    const codeVerifier =
      cookieStore.get(GOOGLE_OAUTH_VERIFIER_COOKIE)?.value ?? "";
    validateGoogleOAuthCallbackInput({
      code,
      codeVerifier,
      expectedState,
      nonce,
      state,
    });

    const idToken = await exchangeGoogleAuthorizationCode({
      code,
      codeVerifier,
      config,
    });
    const identity = await validateGoogleIdToken(idToken, {
      clientId: config.clientId,
      nonce,
    });
    const accountSession = await createGoogleAccountSession(identity);
    const response = redirectResponse(origin, "/minha-conta");
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
    const response = redirectResponse(origin, GOOGLE_ERROR_PATH);
    clearTemporaryCookies(response);
    return response;
  }
}
