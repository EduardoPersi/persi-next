import "server-only";

import { STORE_INFO } from "@/lib/constants/storeInfo";

export type MelhorEnvioEnvironment = "sandbox" | "production";

// N.4 (auditoria F.1): produção usa o subdomínio com "www.", sandbox não usa
// — confirmado na doc oficial de verificação de app do Melhor Envio. Não
// replicar o comportamento do plugin WordPress legado, que usa "www." nos
// dois casos por engano.
const BASE_URLS: Record<MelhorEnvioEnvironment, string> = {
  production: "https://www.melhorenvio.com.br",
  sandbox: "https://sandbox.melhorenvio.com.br",
};

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return value === "true" || value === "1";
}

function readNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export interface MelhorEnvioConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: MelhorEnvioEnvironment;
  baseUrl: string;
  /** Obrigatório pela API: nome do app + e-mail de contato. */
  userAgent: string;
  originPostcode: string;
  timeoutMs: number;
  maxRetries: number;
  quoteCacheTtlMs: number;
  tokenEncryptionKeyBase64: string;
}

export class MelhorEnvioConfigError extends Error {}

/**
 * Mesmo padrão de dupla trava usado em lib/commerce/checkoutConfig.ts:
 * ambiente declarado explicitamente + aprovação explícita de produção —
 * nunca infere produção pelo formato da credencial.
 */
export function isMelhorEnvioEnabled(): boolean {
  const enabled = readBoolean("SHIPPING_ME_ENABLED", false);
  if (!enabled) return false;
  const environment = process.env.MELHOR_ENVIO_ENVIRONMENT?.trim().toLowerCase();
  if (environment === "sandbox") return true;
  if (environment === "production") return readBoolean("SHIPPING_ME_PRODUCTION_APPROVED", false);
  return false;
}

export function getMelhorEnvioConfig(): MelhorEnvioConfig {
  const clientId = process.env.MELHOR_ENVIO_CLIENT_ID?.trim();
  const clientSecret = process.env.MELHOR_ENVIO_CLIENT_SECRET?.trim();
  const redirectUri = process.env.MELHOR_ENVIO_REDIRECT_URI?.trim();
  const userAgent = process.env.MELHOR_ENVIO_USER_AGENT?.trim();
  const tokenEncryptionKeyBase64 = process.env.SHIPPING_MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY?.trim();
  const environment = process.env.MELHOR_ENVIO_ENVIRONMENT?.trim().toLowerCase();

  if (!clientId || !clientSecret || !redirectUri || !userAgent || !tokenEncryptionKeyBase64) {
    throw new MelhorEnvioConfigError(
      "Configuração do Melhor Envio incompleta (client id/secret, redirect URI, User-Agent ou chave de cifragem ausentes).",
    );
  }
  if (environment !== "sandbox" && environment !== "production") {
    throw new MelhorEnvioConfigError("MELHOR_ENVIO_ENVIRONMENT deve ser 'sandbox' ou 'production'.");
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    environment,
    baseUrl: BASE_URLS[environment],
    userAgent,
    originPostcode:
      process.env.MELHOR_ENVIO_ORIGIN_POSTCODE?.trim().replace(/\D/g, "") ||
      STORE_INFO.address.postcode.replace(/\D/g, ""),
    timeoutMs: readNumber("SHIPPING_ME_TIMEOUT_MS", 8_000),
    maxRetries: readNumber("SHIPPING_ME_MAX_RETRIES", 2),
    quoteCacheTtlMs: readNumber("SHIPPING_QUOTE_CACHE_TTL_SECONDS", 900) * 1_000,
    tokenEncryptionKeyBase64,
  };
}
