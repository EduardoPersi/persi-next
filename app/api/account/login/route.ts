import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, getAuthCookieOptions } from "@/lib/auth/cookies";
import { authenticateWithCredentials } from "@/lib/auth/jwt";
import { getAuthenticatedUser } from "@/lib/auth/user";
import { AuthError } from "@/lib/auth/errors";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import { AccountValidationError, isJsonContentType, parseAccountLoginPayload, validateMutationSource } from "@/lib/account/validation";
import { getAccountClientConfig } from "@/services/account/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!validateMutationSource(request.headers, getAccountClientConfig().origin)) throw new AccountValidationError("invalid_origin");
    if (!isJsonContentType(request.headers.get("content-type"))) throw new AccountValidationError("invalid_content_type");
    const payload = parseAccountLoginPayload(await request.text());
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
    const status = error instanceof AccountValidationError ? 400 : error instanceof AuthError ? error.status : 502;
    return NextResponse.json(
      { message: status === 401 ? "Não foi possível entrar com os dados informados." : "Não foi possível acessar sua conta agora." },
      { status, headers: getPrivateAccountHeaders() },
    );
  }
}
