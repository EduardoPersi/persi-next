import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getGoogleOAuthConfig,
  getGoogleOAuthErrorOrigin,
} from "@/lib/account/oauth/google";
import {
  clearOAuthTransactionCookies,
  getOAuthCookieNames,
} from "@/lib/account/oauth/cookies";
import { getOAuthProvider } from "@/lib/account/oauth/provider";
import { createOAuthRedirect } from "@/lib/account/oauth/redirect";
import {
  AUTH_COOKIE_NAME,
  getAuthCookieOptions,
  getExpiredAuthCookieOptions,
} from "@/lib/auth/cookies";
import { authenticateWithSocialToken } from "@/lib/auth/jwt";
import { validateOAuthCallbackInput } from "@/lib/account/oauth/state";
import { writeGoogleDiagnostic } from "@/lib/account/googleDiagnostics";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const GOOGLE_ERROR_PATH = "/entrar?erro=google";

function clearTemporaryCookies(response: NextResponse) {
  clearOAuthTransactionCookies(
    response,
    "google",
    process.env.NODE_ENV === "production",
  );
}

function redirectResponse(origin: string, path: string): NextResponse {
  return createOAuthRedirect(origin, path);
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
    const oauthCookieNames = getOAuthCookieNames("google");
    const expectedState =
      cookieStore.get(oauthCookieNames.state)?.value ?? "";
    const nonce = cookieStore.get(oauthCookieNames.nonce)?.value ?? "";
    const codeVerifier =
      cookieStore.get(oauthCookieNames.verifier)?.value ?? "";
    validateOAuthCallbackInput({
      code,
      codeVerifier,
      expectedState,
      nonce,
      state,
    });

    const provider = getOAuthProvider("google");
    const idToken = await provider.exchangeCode({
      code,
      codeVerifier,
      config,
    });
    const googleUser = await provider.getUser(idToken, {
      config,
      nonce,
    });
    writeGoogleDiagnostic("GOOGLE_EMAIL_RECEIVED");

    const jwt = await authenticateWithSocialToken({ provider: "google", token: idToken });
    if (!jwt.userEmail || jwt.userEmail.trim().toLowerCase() !== googleUser.email.trim().toLowerCase()) {
      throw new Error("Google identity does not match the issued WordPress user");
    }
    writeGoogleDiagnostic("GOOGLE_SESSION_CREATED");
    const response = redirectResponse(origin, "/minha-conta");
    clearTemporaryCookies(response);
    response.cookies.set(
      AUTH_COOKIE_NAME,
      jwt.token,
      getAuthCookieOptions(jwt.expiresAt),
    );
    writeGoogleDiagnostic("GOOGLE_SESSION_COOKIE_UPDATED");
    return response;
  } catch {
    const response = redirectResponse(origin, GOOGLE_ERROR_PATH);
    clearTemporaryCookies(response);
    response.cookies.set(AUTH_COOKIE_NAME, "", getExpiredAuthCookieOptions());
    return response;
  }
}
