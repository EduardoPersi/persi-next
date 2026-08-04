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
import { AuthError } from "@/lib/auth/errors";
import { getAuthenticatedUser } from "@/lib/auth/user";
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

// Diagnóstico temporário: mostra um código curto e não sensível na tela de
// erro para localizar qual validação está rejeitando o login sem precisar
// de acesso a logs de servidor. Remover depois de identificar a causa.
function describeFailure(error: unknown): string {
  if (error instanceof AuthError) return error.code;
  if (error instanceof Error && error.message === "Google identity does not match the issued WordPress user") {
    return "TOKEN_EMAIL_MISMATCH";
  }
  if (error instanceof Error && error.message === "Google identity does not match the authenticated WordPress user") {
    return "ME_EMAIL_MISMATCH";
  }
  return "UNKNOWN";
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
    const authenticatedUser = await getAuthenticatedUser(jwt.token);
    if (authenticatedUser.email.trim().toLowerCase() !== googleUser.email.trim().toLowerCase()) {
      throw new Error("Google identity does not match the authenticated WordPress user");
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
  } catch (error) {
    console.error("google_login_failed", error);
    const reason = describeFailure(error);
    const response = redirectResponse(
      origin,
      `${GOOGLE_ERROR_PATH}&motivo=${encodeURIComponent(reason)}`,
    );
    clearTemporaryCookies(response);
    response.cookies.set(AUTH_COOKIE_NAME, "", getExpiredAuthCookieOptions());
    return response;
  }
}
