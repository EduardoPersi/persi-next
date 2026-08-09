import { NextResponse } from "next/server";
import { parseForgotPayload, RECOVERY_MESSAGE } from "@/lib/account/access";
import { AccountValidationError, isJsonContentType, validateMutationSource } from "@/lib/account/validation";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import { forgotAccountPassword } from "@/services/account/access";
import { getAccountClientConfig } from "@/services/account/client";
import { getRequestIp, verifyRecaptcha } from "@/lib/recaptcha/verify";
export const dynamic = "force-dynamic"; export const revalidate = 0; export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = getPrivateAccountHeaders();
  try {
    const config = getAccountClientConfig();
    if (!validateMutationSource(request.headers, config.origin) || !isJsonContentType(request.headers.get("content-type"))) throw new AccountValidationError();
    const payload = parseForgotPayload(await request.text());
    const { band } = await verifyRecaptcha({
      token: payload.recaptchaToken,
      action: "account_forgot_password",
      form: "account-forgot-password",
      ip: getRequestIp(request.headers),
    });
    if (band !== "reject") await forgotAccountPassword(payload.email, { config });
  } catch {}
  return NextResponse.json({ message: RECOVERY_MESSAGE }, { status: 200, headers });
}
