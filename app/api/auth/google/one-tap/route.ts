import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateGoogleIdToken, getGoogleOneTapClientId } from "@/lib/account/oauth/google";
import {
  GOOGLE_ONE_TAP_NONCE_COOKIE,
  getGoogleOneTapNonceCookieOptions,
} from "@/lib/account/oauth/cookies";
import { OAuthError } from "@/lib/account/oauth/errors";
import { AccountServiceError } from "@/services/account/client";
import {
  AUTH_COOKIE_NAME,
  getAuthCookieOptions,
} from "@/lib/auth/cookies";
import { authenticateWithSocialToken } from "@/lib/auth/jwt";
import { AuthError } from "@/lib/auth/errors";
import { getAuthenticatedUser } from "@/lib/auth/user";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import {
  AccountValidationError,
  isJsonContentType,
  parseGoogleOneTapPayload,
  validateMutationSource,
} from "@/lib/account/validation";
import { getAccountClientConfig } from "@/services/account/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

function clearNonceCookie(response: NextResponse) {
  response.cookies.set(
    GOOGLE_ONE_TAP_NONCE_COOKIE,
    "",
    { ...getGoogleOneTapNonceCookieOptions(process.env.NODE_ENV === "production"), maxAge: 0 },
  );
}

export async function POST(request: Request) {
  try {
    if (!validateMutationSource(request.headers, getAccountClientConfig().origin)) {
      throw new AccountValidationError("invalid_origin");
    }
    if (!isJsonContentType(request.headers.get("content-type"))) {
      throw new AccountValidationError("invalid_content_type");
    }
    const { credential } = parseGoogleOneTapPayload(await request.text());

    const cookieStore = await cookies();
    const nonce = cookieStore.get(GOOGLE_ONE_TAP_NONCE_COOKIE)?.value ?? "";
    if (!nonce) {
      throw new OAuthError(400, "OAUTH_STATE_INVALID", "Missing One Tap nonce");
    }

    const googleUser = await validateGoogleIdToken(credential, {
      clientId: getGoogleOneTapClientId(),
      nonce,
    });

    const jwt = await authenticateWithSocialToken({ provider: "google", token: credential });
    if (!jwt.userEmail || jwt.userEmail.trim().toLowerCase() !== googleUser.email) {
      console.error("google_one_tap_token_email_mismatch", {
        google: maskEmail(googleUser.email),
        issued: jwt.userEmail ? maskEmail(jwt.userEmail) : null,
      });
      throw new AuthError("AUTH_RESPONSE_INVALID", "Identidade Google não confere.", 502);
    }
    const authenticatedUser = await getAuthenticatedUser(jwt.token);
    if (authenticatedUser.email.trim().toLowerCase() !== googleUser.email) {
      console.error("google_one_tap_me_email_mismatch", {
        google: maskEmail(googleUser.email),
        me: maskEmail(authenticatedUser.email),
        meId: authenticatedUser.id,
      });
      throw new AuthError("AUTH_RESPONSE_INVALID", "Identidade Google não confere.", 502);
    }

    const response = NextResponse.json(
      {
        authenticated: true,
        expiresAt: jwt.expiresAt,
        customer: {
          id: authenticatedUser.id,
          firstName: authenticatedUser.firstName,
          displayName: authenticatedUser.displayName,
          email: authenticatedUser.email,
          roles: authenticatedUser.roles,
          avatar: authenticatedUser.avatar,
          permissions: authenticatedUser.permissions,
          authenticated: true,
          jwtExpiration: jwt.expiresAt,
        },
      },
      { headers: getPrivateAccountHeaders() },
    );
    clearNonceCookie(response);
    response.cookies.set(AUTH_COOKIE_NAME, jwt.token, getAuthCookieOptions(jwt.expiresAt));
    return response;
  } catch (error) {
    console.error("google_one_tap_failed", error);
    const status =
      error instanceof AccountValidationError
        ? 400
        : error instanceof AuthError || error instanceof AccountServiceError
          ? error.status
          : 502;
    const response = NextResponse.json(
      { authenticated: false, message: "Não foi possível entrar com o Google agora." },
      { status, headers: getPrivateAccountHeaders() },
    );
    clearNonceCookie(response);
    return response;
  }
}
