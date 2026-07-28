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
    if (!validateMutationSource(request.headers, config.origin)) {
      throw new AccountValidationError(
        "Invalid account source",
        "ACCOUNT_REGISTER_SOURCE_INVALID",
      );
    }
    if (!isJsonContentType(request.headers.get("content-type"))) {
      throw new AccountValidationError(
        "Invalid account content type",
        "ACCOUNT_REGISTER_PAYLOAD_INVALID",
      );
    }
    return response(await registerAccount(parseRegisterPayload(await request.text()), { config }), 201);
  } catch (error) {
    const status =
      error instanceof AccountValidationError
        ? 400
        : error instanceof AccountServiceError &&
            [400, 401, 409, 429, 503].includes(error.status)
          ? error.status
          : 502;
    const code =
      error instanceof AccountValidationError
        ? error.code
        : status === 401
          ? "ACCOUNT_REGISTER_WORDPRESS_401"
          : status === 409
            ? "ACCOUNT_REGISTER_EMAIL_EXISTS"
            : "ACCOUNT_REGISTER_REMOTE_ERROR";
    const message =
      code === "ACCOUNT_REGISTER_PASSWORD_INVALID"
        ? "A senha deve ter pelo menos 8 caracteres."
        : code === "ACCOUNT_REGISTER_PASSWORD_MISMATCH"
          ? "As senhas não coincidem."
          : code === "ACCOUNT_REGISTER_TERMS_REQUIRED"
            ? "Aceite os termos e a Política de Privacidade."
            : status === 409
              ? "Já existe uma conta com este e-mail. Tente entrar ou recuperar sua senha."
              : status === 429
                ? "Muitas tentativas. Aguarde e tente novamente."
                : "Não foi possível criar sua conta agora.";
    return response({ message, code }, status);
  }
}
