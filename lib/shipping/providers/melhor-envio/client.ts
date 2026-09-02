import "server-only";

import { ShippingProviderError } from "../../core/errors";
import type { MelhorEnvioConfig } from "./config";

const CALCULATE_PATH = "/api/v2/me/shipment/calculate";

interface CalculateProductInput {
  id: string;
  width: number;
  height: number;
  length: number;
  weight: number;
  insurance_value: number;
  quantity: number;
}

export interface CalculateShipmentPayload {
  from: { postal_code: string };
  to: { postal_code: string };
  products: CalculateProductInput[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number): boolean {
  return status >= 500 || status === 0;
}

/**
 * O plugin WordPress legado não tinha retry/backoff nenhum (achado da
 * auditoria) — aqui, falha transitória (timeout, 5xx) tenta de novo com
 * backoff exponencial curto; erro do cliente (401/422) não é retentado.
 */
export async function calculateShipment(
  config: MelhorEnvioConfig,
  accessToken: string,
  payload: CalculateShipmentPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const maxAttempts = config.maxRetries + 1;
  let lastError: ShippingProviderError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(`${config.baseUrl}${CALCULATE_PATH}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": config.userAgent,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (response.status === 401) {
        throw new ShippingProviderError("Token do Melhor Envio inválido ou expirado.", "AUTH", 401);
      }
      if (response.status === 422) {
        throw new ShippingProviderError(
          "Melhor Envio rejeitou a requisição de cotação.",
          "INVALID_REQUEST",
          422,
        );
      }
      if (!response.ok) {
        throw new ShippingProviderError(
          `Melhor Envio indisponível (HTTP ${response.status}).`,
          "UNAVAILABLE",
          response.status,
        );
      }

      return await response.json();
    } catch (error) {
      const providerError = toProviderError(error);
      lastError = providerError;
      const canRetry = attempt < maxAttempts && isRetryable(providerError.status);
      if (!canRetry) throw providerError;
      await sleep(300 * 2 ** (attempt - 1));
    }
  }

  // Inatingível na prática (o loop sempre retorna ou lança), mas TypeScript
  // exige um retorno explícito para todos os caminhos.
  throw lastError ?? new ShippingProviderError("Falha desconhecida ao cotar frete.", "UNAVAILABLE", 0);
}

function toProviderError(error: unknown): ShippingProviderError {
  if (error instanceof ShippingProviderError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new ShippingProviderError("Tempo esgotado ao consultar o Melhor Envio.", "TIMEOUT", 0);
  }
  return new ShippingProviderError("Falha de rede ao consultar o Melhor Envio.", "UNAVAILABLE", 0);
}
