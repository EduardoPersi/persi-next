import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, getAuthCookieOptions } from "@/lib/auth/cookies";
import { authenticateWithCredentials } from "@/lib/auth/jwt";
import { getAuthenticatedUser } from "@/lib/auth/user";
import { AuthError } from "@/lib/auth/errors";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import { AccountValidationError, isJsonContentType, parseAccountLoginPayload, validateMutationSource } from "@/lib/account/validation";
import { getAccountClientConfig, AccountServiceError } from "@/services/account/client";
import { checkLoginGuard } from "@/services/account/access";
import { getRequestIp, verifyRecaptcha } from "@/lib/recaptcha/verify";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const config = getAccountClientConfig();
    if (!validateMutationSource(request.headers, config.origin)) throw new AccountValidationError("invalid_origin");
    if (!isJsonContentType(request.headers.get("content-type"))) throw new AccountValidationError("invalid_content_type");
    const payload = parseAccountLoginPayload(await request.text());
    const { band } = await verifyRecaptcha({
      token: payload.recaptchaToken,
      action: "account_login",
      form: "account-login",
      ip: getRequestIp(request.headers),
    });
    if (band === "reject") throw new AccountValidationError("recaptcha_rejected");
    await checkLoginGuard(payload.identifier, { config });
    const result = await authenticateWithCredentials({ username: payload.identifier, password: payload.password });
    const user = await getAuthenticatedUser(result.token);
    const expiresAt = result.expiresAt;
    const response = NextResponse.json(
      { authenticated: true, expiresAt, customer: { id: user.id, firstName: user.firstName, displayName: user.displayName, email: user.email, roles: user.roles, avatar: user.avatar, permissions: user.permissions, authenticated: true, jwtExpiration: expiresAt } },
      { headers: getPrivateAccountHeaders() },
    );
    response.cookies.set(AUTH_COOKIE_NAME, result.token, getAuthCookieOptions(expiresAt));
    return response;
  } catch (error) {
    const status =
      error instanceof AccountValidationError
        ? 400
        : error instanceof AuthError
          ? error.status
          : error instanceof AccountServiceError && [429, 503].includes(error.status)
            ? error.status
            : 502;
    const message =
      status === 401
        ? "Não foi possível entrar com os dados informados."
        : status === 429
          ? "Muitas tentativas. Aguarde e tente novamente."
          : "Não foi possível acessar sua conta agora.";
    return NextResponse.json(
      { message },
      { status, headers: getPrivateAccountHeaders() },
    );
  }
}
