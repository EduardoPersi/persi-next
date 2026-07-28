import { NextResponse } from "next/server";
import { parseRegisterPayload } from "@/lib/account/access";
import { AccountValidationError, isJsonContentType, validateMutationSource } from "@/lib/account/validation";
import { getPrivateAccountHeaders } from "@/lib/account/responsePolicy";
import { registerAccount } from "@/services/account/access";
import { AccountServiceError, getAccountClientConfig } from "@/services/account/client";
export const dynamic = "force-dynamic"; export const revalidate = 0; export const runtime = "nodejs";
const response = (body: object, status: number) => NextResponse.json(body, { status, headers: getPrivateAccountHeaders() });
export async function POST(request: Request) {
  try {
    const config = getAccountClientConfig();
    if (!validateMutationSource(request.headers, config.origin) || !isJsonContentType(request.headers.get("content-type"))) throw new AccountValidationError();
    return response(await registerAccount(parseRegisterPayload(await request.text()), { config }), 201);
  } catch (error) {
    const status = error instanceof AccountValidationError ? 400 : error instanceof AccountServiceError && [400,409,429,503].includes(error.status) ? error.status : 502;
    const message = status === 409 ? "Não foi possível criar a conta com os dados informados." : status === 429 ? "Muitas tentativas. Aguarde e tente novamente." : status === 400 ? "Confira os dados informados." : "Não foi possível criar a conta agora.";
    return response({ message }, status);
  }
}
