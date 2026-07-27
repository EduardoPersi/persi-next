import { NextResponse } from "next/server";
import {
  getAccountSessionCookieOptions,
  ACCOUNT_SESSION_COOKIE,
} from "@/lib/account/sessionCookie";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import {
  isJsonContentType,
  parseAccountLoginPayload,
  validateMutationSource,
  AccountValidationError,
} from "@/lib/account/validation";
import { loginAccount } from "@/services/account/auth";
import {
  AccountServiceError,
  getAccountClientConfig,
} from "@/services/account/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const MESSAGES: Record<number, string> = {
  400: "Confira os dados informados.",
  401: "Não foi possível entrar com os dados informados.",
  429: "Muitas tentativas. Aguarde um momento e tente novamente.",
  502: "Não foi possível acessar sua conta agora. Tente novamente em instantes.",
  503: "Não foi possível acessar sua conta agora. Tente novamente em instantes.",
};

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: getPrivateAccountHeaders(),
  });
}

export async function POST(request: Request) {
  try {
    const config = getAccountClientConfig();
    if (!validateMutationSource(request.headers, config.origin)) {
      return response({ message: MESSAGES[400] }, 400);
    }
    if (!isJsonContentType(request.headers.get("content-type"))) {
      return response({ message: MESSAGES[400] }, 400);
    }

    const payload = parseAccountLoginPayload(await request.text());
    const result = await loginAccount(payload, { config });
    const publicSession = {
      authenticated: true,
      expiresAt: result.expiresAt,
      customer: result.customer,
    };
    const nextResponse = response(publicSession, 200);
    nextResponse.cookies.set(
      ACCOUNT_SESSION_COOKIE,
      result.sessionToken,
      getAccountSessionCookieOptions({
        isProduction: process.env.NODE_ENV === "production",
        remember: payload.remember,
        expiresAt: result.expiresAt,
      }),
    );
    return nextResponse;
  } catch (error) {
    const status =
      error instanceof AccountValidationError
        ? 400
        : error instanceof AccountServiceError &&
            [400, 401, 429, 502, 503].includes(error.status)
          ? error.status
          : 502;
    return response({ message: MESSAGES[status] ?? MESSAGES[502] }, status);
  }
}
