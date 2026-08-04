import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, getExpiredAuthCookieOptions } from "@/lib/auth/cookies";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import { validateMutationSource } from "@/lib/account/validation";
import { getAccountClientConfig } from "@/services/account/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  if (!validateMutationSource(request.headers, getAccountClientConfig().origin)) {
    return NextResponse.json({ authenticated: false }, { status: 400, headers: getPrivateAccountHeaders() });
  }
  const response = NextResponse.json({ authenticated: false }, { headers: getPrivateAccountHeaders() });
  response.cookies.set(AUTH_COOKIE_NAME, "", getExpiredAuthCookieOptions());
  return response;
}
