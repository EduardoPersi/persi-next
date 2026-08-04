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
  AUTH_COOKIE_NAME,
  getAuthCookieOptions,
  getExpiredAuthCookieOptions,
} from "@/lib/auth/cookies";
import { authenticateWithSocialToken } from "@/lib/auth/jwt";
import { getAuthenticatedUser } from "@/lib/auth/user";
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
    const facebookUser = await provider.getUser(token, { config, nonce });
    const jwt = await authenticateWithSocialToken({ provider: "facebook", token: token.accessToken });
    if (!jwt.userEmail || jwt.userEmail.trim().toLowerCase() !== facebookUser.email.trim().toLowerCase()) {
      throw new Error("Facebook identity does not match the issued WordPress user");
    }
    const authenticatedUser = await getAuthenticatedUser(jwt.token);
    if (authenticatedUser.email.trim().toLowerCase() !== facebookUser.email.trim().toLowerCase()) {
      throw new Error("Facebook identity does not match the authenticated WordPress user");
    }

    const response = createOAuthRedirect(origin, "/minha-conta");
    clearTemporaryCookies(response);
    response.cookies.set(
      AUTH_COOKIE_NAME,
      jwt.token,
      getAuthCookieOptions(jwt.expiresAt),
    );
    return response;
  } catch {
    const response = createOAuthRedirect(origin, "/entrar?erro=facebook");
    clearTemporaryCookies(response);
    response.cookies.set(AUTH_COOKIE_NAME, "", getExpiredAuthCookieOptions());
    return response;
  }
}
