import { NextResponse } from "next/server";
import { parseResetPayload } from "@/lib/account/access";
import { AccountValidationError, isJsonContentType, validateMutationSource } from "@/lib/account/validation";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import { resetAccountPassword } from "@/services/account/access";
import { AccountServiceError, getAccountClientConfig } from "@/services/account/client";
import { getRequestIp, verifyRecaptcha } from "@/lib/recaptcha/verify";
export const dynamic = "force-dynamic"; export const revalidate = 0; export const runtime = "nodejs";
const response = (body: object, status: number) => NextResponse.json(body, { status, headers: getPrivateAccountHeaders() });
export async function POST(request: Request) {
  try {
    const config = getAccountClientConfig();
    if (!validateMutationSource(request.headers, config.origin) || !isJsonContentType(request.headers.get("content-type"))) throw new AccountValidationError();
    const { recaptchaToken, ...payload } = parseResetPayload(await request.text());
    const { band } = await verifyRecaptcha({
      token: recaptchaToken,
      action: "account_reset_password",
      form: "account-reset-password",
      ip: getRequestIp(request.headers),
    });
    if (band === "reject") throw new AccountValidationError();
    return response(await resetAccountPassword(payload, { config }), 200);
  } catch (error) {
    const status = error instanceof AccountValidationError ? 400 : error instanceof AccountServiceError && [400,429,503].includes(error.status) ? error.status : 502;
    return response({ message: status === 400 ? "Link ou dados inválidos." : "Não foi possível redefinir a senha agora." }, status);
  }
}
