import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCOUNT_SESSION_COOKIE,
  getExpiredAccountSessionCookieOptions,
} from "@/lib/account/sessionCookie";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import { validateMutationSource } from "@/lib/account/validation";
import { logoutAccount } from "@/services/account/auth";
import { getAccountClientConfig } from "@/services/account/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function response(status = 200) {
  return NextResponse.json(
    { authenticated: false },
    { status, headers: getPrivateAccountHeaders() },
  );
}

export async function POST(request: Request) {
  let config;
  try {
    config = getAccountClientConfig();
  } catch {
    const nextResponse = response();
    nextResponse.cookies.set(
      ACCOUNT_SESSION_COOKIE,
      "",
      getExpiredAccountSessionCookieOptions(
        process.env.NODE_ENV === "production",
      ),
    );
    return nextResponse;
  }

  if (!validateMutationSource(request.headers, config.origin)) {
    return response(400);
  }

  const token = (await cookies()).get(ACCOUNT_SESSION_COOKIE)?.value;
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    try {
      await logoutAccount(token, { config });
    } catch {
      // O encerramento local deve funcionar mesmo com o WordPress indisponível.
    }
  }

  const nextResponse = response();
  nextResponse.cookies.set(
    ACCOUNT_SESSION_COOKIE,
    "",
    getExpiredAccountSessionCookieOptions(
      process.env.NODE_ENV === "production",
    ),
  );
  return nextResponse;
}
