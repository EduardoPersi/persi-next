import "server-only";
import { MercadoPagoPaymentError, type MercadoPagoHttpMethod } from "./errors.ts";

export { MercadoPagoPaymentError, type MercadoPagoHttpMethod };

const REQUEST_TIMEOUT_MS = 10_000;

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new MercadoPagoPaymentError(
      503,
      `Missing server configuration: ${name}`,
      "MERCADOPAGO_CONFIG_MISSING",
    );
  }
  return value;
}

function getMercadoPagoBaseUrl(): string {
  return requireEnvironmentValue("MERCADOPAGO_API_BASE_URL").replace(/\/+$/, "");
}

export async function mercadopagoRequest<T>(
  path: string,
  method: MercadoPagoHttpMethod,
  body?: Record<string, unknown>,
  options: { idempotencyKey?: string } = {},
): Promise<T> {
  const baseUrl = getMercadoPagoBaseUrl();
  const token = requireEnvironmentValue("MERCADOPAGO_ACCESS_TOKEN");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.idempotencyKey ? { "X-Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new MercadoPagoPaymentError(
      502,
      "Falha na comunicação com o Mercado Pago",
      "MERCADOPAGO_API_UNAVAILABLE",
    );
  }

  const parsedBody = await response.json().catch(() => null);

  if (!response.ok) {
    console.error("[mercadopago-client]", {
      path,
      method,
      status: response.status,
      errorMessages:
        parsedBody && typeof parsedBody === "object" && "cause" in parsedBody
          ? (parsedBody as { cause: unknown }).cause
          : parsedBody,
    });
    throw new MercadoPagoPaymentError(
      response.status >= 400 && response.status < 600 ? response.status : 502,
      "O Mercado Pago recusou a requisição",
      "MERCADOPAGO_API_ERROR",
    );
  }

  return parsedBody as T;
}
