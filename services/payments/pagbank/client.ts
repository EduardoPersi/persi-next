import "server-only";
import { PagBankPaymentError, type PagBankHttpMethod } from "./errors.ts";

export { PagBankPaymentError, type PagBankHttpMethod };

const REQUEST_TIMEOUT_MS = 10_000;

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new PagBankPaymentError(
      503,
      `Missing server configuration: ${name}`,
      "PAGBANK_CONFIG_MISSING",
    );
  }
  return value;
}

function getPagBankBaseUrl(): string {
  return requireEnvironmentValue("PAGBANK_API_BASE_URL").replace(/\/+$/, "");
}

export async function pagbankRequest<T>(
  path: string,
  method: PagBankHttpMethod,
  body?: Record<string, unknown>,
): Promise<T> {
  const baseUrl = getPagBankBaseUrl();
  const token = requireEnvironmentValue("PAGBANK_CLIENT_SECRET");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new PagBankPaymentError(
      502,
      "Falha na comunicação com o PagBank",
      "PAGBANK_API_UNAVAILABLE",
    );
  }

  const parsedBody = await response.json().catch(() => null);

  if (!response.ok) {
    console.error("[pagbank-client]", {
      path,
      method,
      status: response.status,
      errorMessages:
        parsedBody && typeof parsedBody === "object" && "error_messages" in parsedBody
          ? (parsedBody as { error_messages: unknown }).error_messages
          : parsedBody,
    });
    throw new PagBankPaymentError(
      response.status >= 400 && response.status < 600 ? response.status : 502,
      "O PagBank recusou a requisição",
      "PAGBANK_API_ERROR",
    );
  }

  return parsedBody as T;
}
