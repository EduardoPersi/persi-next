import { NextResponse } from "next/server";
import {
  getFacebookOAuthConfig,
  getFacebookOAuthErrorOrigin,
} from "@/lib/account/oauth/facebook";
import { setOAuthTransactionCookies } from "@/lib/account/oauth/cookies";
import { getOAuthProvider } from "@/lib/account/oauth/provider";
import { createOAuthRedirect } from "@/lib/account/oauth/redirect";
import {
  createOAuthPkce,
  generateOAuthValue,
} from "@/lib/account/oauth/state";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  const errorOrigin = getFacebookOAuthErrorOrigin();
  try {
    const config = getFacebookOAuthConfig();
    const state = generateOAuthValue();
    const nonce = generateOAuthValue();
    const { codeChallenge, codeVerifier } = createOAuthPkce();
    const provider = getOAuthProvider("facebook");
    const response = NextResponse.redirect(
      provider.buildAuthorizationUrl({
        codeChallenge,
        config,
        nonce,
        state,
      }),
    );
    setOAuthTransactionCookies(
      response,
      "facebook",
      { codeVerifier, nonce, state },
      process.env.NODE_ENV === "production",
    );
    return response;
  } catch {
    return createOAuthRedirect(errorOrigin, "/entrar?erro=facebook");
  }
}
