import { NextResponse } from "next/server";
import {
  getGoogleOAuthConfig,
  getGoogleOAuthErrorOrigin,
} from "@/lib/account/oauth/google";
import { setOAuthTransactionCookies } from "@/lib/account/oauth/cookies";
import { getOAuthProvider } from "@/lib/account/oauth/provider";
import { createOAuthRedirect } from "@/lib/account/oauth/redirect";
import {
  createOAuthPkce,
  generateOAuthValue,
} from "@/lib/account/oauth/state";
import {
  getGoogleStartConfigurationCodes,
  writeGoogleStartDiagnostic,
} from "@/lib/account/googleStartDiagnostics";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function redirectToGoogleError(): NextResponse {
  return createOAuthRedirect(
    getGoogleOAuthErrorOrigin(),
    "/entrar?erro=google",
  );
}

export async function GET() {
  const configurationCodes = getGoogleStartConfigurationCodes();
  if (configurationCodes.length > 0) {
    configurationCodes.forEach(writeGoogleStartDiagnostic);
    return redirectToGoogleError();
  }

  let config;
  try {
    config = getGoogleOAuthConfig();
  } catch {
    writeGoogleStartDiagnostic("GOOGLE_START_REDIRECT_URI_INVALID");
    return redirectToGoogleError();
  }

  let state: string;
  let nonce: string;
  try {
    state = generateOAuthValue();
    nonce = generateOAuthValue();
  } catch {
    writeGoogleStartDiagnostic("GOOGLE_START_STATE_FAILED");
    return redirectToGoogleError();
  }

  let codeChallenge: string;
  let codeVerifier: string;
  try {
    ({ codeChallenge, codeVerifier } = createOAuthPkce());
  } catch {
    writeGoogleStartDiagnostic("GOOGLE_START_PKCE_FAILED");
    return redirectToGoogleError();
  }

  let response: NextResponse;
  try {
    const provider = getOAuthProvider("google");
    response = NextResponse.redirect(
      provider.buildAuthorizationUrl({
        codeChallenge,
        config,
        nonce,
        state,
      }),
      { headers: getPrivateAccountHeaders() },
    );
  } catch {
    writeGoogleStartDiagnostic("GOOGLE_START_REDIRECT_URI_INVALID");
    return redirectToGoogleError();
  }

  try {
    setOAuthTransactionCookies(
      response,
      "google",
      { codeVerifier, nonce, state },
      process.env.NODE_ENV === "production",
    );
  } catch {
    writeGoogleStartDiagnostic("GOOGLE_START_COOKIE_FAILED");
    return redirectToGoogleError();
  }

  writeGoogleStartDiagnostic("GOOGLE_START_URL_CREATED");
  return response;
}
