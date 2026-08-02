import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCOUNT_SESSION_COOKIE,
  getExpiredAccountSessionCookieOptions,
} from "@/lib/account/sessionCookie";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import { getAccountSession } from "@/services/account/auth";
import { AccountServiceError } from "@/services/account/client";
import { getServerAccountSession } from "@/services/account/serverSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function response(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: getPrivateAccountHeaders(),
  });
}

function clearSessionCookie(nextResponse: NextResponse) {
  nextResponse.cookies.set(
    ACCOUNT_SESSION_COOKIE,
    "",
    getExpiredAccountSessionCookieOptions(
      process.env.NODE_ENV === "production",
    ),
  );
}

export async function GET() {
  const token = (await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value;

  if (!token) {
    const session = await getServerAccountSession();
    return response(session ?? { authenticated: false });
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    const invalidResponse = response({ authenticated: false });
    clearSessionCookie(invalidResponse);
    return invalidResponse;
  }

  try {
    const session = await getAccountSession(token);
    const nextResponse = response(session);
    if (!session.authenticated) clearSessionCookie(nextResponse);
    return nextResponse;
  } catch (error) {
    const status =
      error instanceof AccountServiceError && error.status === 503 ? 503 : 502;
    return response(
      {
        message:
          "Não foi possível acessar sua conta agora. Tente novamente em instantes.",
      },
      status,
    );
  }
}
