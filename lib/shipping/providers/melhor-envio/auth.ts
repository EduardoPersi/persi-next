import "server-only";

import { ShippingProviderError } from "../../core/errors";
import type { MelhorEnvioConfig } from "./config";

export interface StoredCredential {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

export interface CredentialStore {
  load(): Promise<StoredCredential | null>;
  save(credential: StoredCredential): Promise<void>;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

// NOTA (documentar na PR): a doc pública descreve o fluxo authorization code
// e a validade dos tokens (30/45 dias), mas não confirma o path literal do
// endpoint de troca — /oauth/token segue a convenção OAuth2 padrão usada
// pelo Melhor Envio em exemplos públicos. Revalidar contra o app real
// registrado no painel antes de autorizar em produção.
const TOKEN_PATH = "/oauth/token";

// Margem de segurança: renova antes de expirar de fato, evitando uma janela
// onde uma cotação em andamento use um token que expira no meio da chamada.
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;

function parseTokenResponse(body: TokenResponse, now: Date): StoredCredential {
  const accessToken = typeof body.access_token === "string" ? body.access_token : null;
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : null;
  const expiresInSeconds = typeof body.expires_in === "number" ? body.expires_in : null;
  if (!accessToken || !refreshToken || expiresInSeconds === null) {
    throw new ShippingProviderError(
      "Resposta de autenticação do Melhor Envio incompleta.",
      "AUTH",
      502,
    );
  }
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(now.getTime() + expiresInSeconds * 1_000),
    // A API documenta refresh_token válido por 45 dias; expires_in do corpo
    // só cobre o access_token, então fixamos a validade do refresh aqui.
    refreshTokenExpiresAt: new Date(now.getTime() + 45 * 24 * 60 * 60 * 1_000),
  };
}

async function requestToken(
  config: MelhorEnvioConfig,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const response = await fetchImpl(`${config.baseUrl}${TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": config.userAgent,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) {
    throw new ShippingProviderError(
      `Falha ao autenticar no Melhor Envio (HTTP ${response.status}).`,
      response.status === 401 ? "AUTH" : "UNAVAILABLE",
      response.status,
    );
  }
  return (await response.json()) as TokenResponse;
}

export async function exchangeAuthorizationCode(
  config: MelhorEnvioConfig,
  authorizationCode: string,
  store: CredentialStore,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<StoredCredential> {
  const body = await requestToken(
    config,
    {
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code: authorizationCode,
    },
    fetchImpl,
  );
  const credential = parseTokenResponse(body, now);
  await store.save(credential);
  return credential;
}

async function refreshAccessToken(
  config: MelhorEnvioConfig,
  refreshToken: string,
  store: CredentialStore,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<StoredCredential> {
  const body = await requestToken(
    config,
    {
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    },
    fetchImpl,
  );
  const credential = parseTokenResponse(body, now);
  await store.save(credential);
  return credential;
}

/**
 * Retorna um access_token válido, renovando automaticamente antes da
 * expiração (nunca deixa a chamada de cotação falhar por token vencido).
 * Se nem o refresh_token estiver mais válido, exige reautorização manual —
 * não há como recuperar disso automaticamente (mesma limitação da própria
 * API do Melhor Envio).
 */
export async function getValidAccessToken(
  config: MelhorEnvioConfig,
  store: CredentialStore,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<string> {
  const stored = await store.load();
  if (!stored) {
    throw new ShippingProviderError(
      "Melhor Envio ainda não autorizado — execute o fluxo de autorização inicial.",
      "AUTH",
      401,
    );
  }

  const accessTokenValid = stored.accessTokenExpiresAt.getTime() - now.getTime() > REFRESH_SAFETY_MARGIN_MS;
  if (accessTokenValid) return stored.accessToken;

  if (stored.refreshTokenExpiresAt.getTime() <= now.getTime()) {
    throw new ShippingProviderError(
      "Refresh token do Melhor Envio expirado — é necessário reautorizar manualmente.",
      "AUTH",
      401,
    );
  }

  const refreshed = await refreshAccessToken(config, stored.refreshToken, store, fetchImpl, now);
  return refreshed.accessToken;
}
