import { NextResponse } from "next/server";
import {
  GOOGLE_ONE_TAP_NONCE_COOKIE,
  getGoogleOneTapNonceCookieOptions,
} from "@/lib/account/oauth/cookies";
import { generateOAuthValue } from "@/lib/account/oauth/state";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET() {
  const nonce = generateOAuthValue();
  const response = NextResponse.json(
    { nonce },
    { headers: getPrivateAccountHeaders() },
  );
  response.cookies.set(
    GOOGLE_ONE_TAP_NONCE_COOKIE,
    nonce,
    getGoogleOneTapNonceCookieOptions(process.env.NODE_ENV === "production"),
  );
  return response;
}
