import { NextResponse } from "next/server";
import {
  buildGoogleAuthorizationUrl,
  createGooglePkce,
  generateGoogleOAuthValue,
  getGoogleOAuthConfig,
  getGoogleOAuthCookieOptions,
  getGoogleOAuthErrorOrigin,
  GOOGLE_OAUTH_NONCE_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_VERIFIER_COOKIE,
} from "@/lib/account/googleOAuth";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  try {
    const config = getGoogleOAuthConfig();
    const state = generateGoogleOAuthValue();
    const nonce = generateGoogleOAuthValue();
    const { codeChallenge, codeVerifier } = createGooglePkce();
    const response = NextResponse.redirect(
      buildGoogleAuthorizationUrl({
        codeChallenge,
        config,
        nonce,
        state,
      }),
      { headers: getPrivateAccountHeaders() },
    );
    const options = getGoogleOAuthCookieOptions(
      process.env.NODE_ENV === "production",
    );
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, options);
    response.cookies.set(GOOGLE_OAUTH_NONCE_COOKIE, nonce, options);
    response.cookies.set(GOOGLE_OAUTH_VERIFIER_COOKIE, codeVerifier, options);
    return response;
  } catch {
    return NextResponse.redirect(
      new URL("/entrar?erro=google", getGoogleOAuthErrorOrigin()),
      { headers: getPrivateAccountHeaders() },
    );
  }
}
