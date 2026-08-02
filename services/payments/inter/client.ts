import "server-only";
import https from "node:https";
import axios, { AxiosError, type AxiosInstance } from "axios";
import { InterPaymentError, type InterHttpMethod } from "./errors.ts";

export { InterPaymentError, type InterHttpMethod };

interface InterConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  certificate: Buffer;
  privateKey: Buffer;
}

function requireEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new InterPaymentError(
      503,
      `Missing server configuration: ${name}`,
      "INTER_CONFIG_MISSING",
    );
  }
  return value;
}

function decodeBase64Secret(name: string): Buffer {
  const raw = requireEnvironmentValue(name);
  try {
    const buffer = Buffer.from(raw, "base64");
    if (buffer.length === 0) throw new Error("empty");
    return buffer;
  } catch {
    throw new InterPaymentError(
      503,
      `Invalid server configuration: ${name}`,
      "INTER_CONFIG_MISSING",
    );
  }
}

function getInterConfig(): InterConfig {
  return {
    baseUrl: requireEnvironmentValue("INTER_API_BASE_URL").replace(/\/+$/, ""),
    clientId: requireEnvironmentValue("INTER_CLIENT_ID"),
    clientSecret: requireEnvironmentValue("INTER_CLIENT_SECRET"),
    certificate: decodeBase64Secret("INTER_CERTIFICATE_BASE64"),
    privateKey: decodeBase64Secret("INTER_PRIVATE_KEY_BASE64"),
  };
}

let cachedAgent: { agent: https.Agent; forConfig: InterConfig } | null = null;

function getInterHttpsAgent(config: InterConfig): https.Agent {
  if (cachedAgent && cachedAgent.forConfig === config) return cachedAgent.agent;

  const agent = new https.Agent({
    cert: config.certificate,
    key: config.privateKey,
  });
  cachedAgent = { agent, forConfig: config };
  return agent;
}

let cachedClient: { instance: AxiosInstance; forConfig: InterConfig } | null = null;

function getInterAxiosClient(config: InterConfig): AxiosInstance {
  if (cachedClient && cachedClient.forConfig === config) return cachedClient.instance;

  const instance = axios.create({
    baseURL: config.baseUrl,
    httpsAgent: getInterHttpsAgent(config),
    timeout: 10_000,
  });
  cachedClient = { instance, forConfig: config };
  return instance;
}

interface CachedInterToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedInterToken | null = null;

const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;

// Scopes cobrem Pix (cob) e cobrança bancária/boleto — ajustar caso a conta
// Inter não tenha um dos produtos habilitado.
const INTER_OAUTH_SCOPE =
  "cob.write cob.read pix.write pix.read boleto-cobranca.write boleto-cobranca.read webhook.write webhook.read";

async function getInterAccessToken(config: InterConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  const client = getInterAxiosClient(config);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: INTER_OAUTH_SCOPE,
  });

  let response;
  try {
    response = await client.post<{ access_token: string; expires_in: number }>(
      "/oauth/v2/token",
      body.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
  } catch (error) {
    throw toInterPaymentError(error, "Falha ao autenticar com o Banco Inter");
  }

  const { access_token: accessToken, expires_in: expiresIn } = response.data;
  if (!accessToken || !Number.isFinite(expiresIn)) {
    throw new InterPaymentError(
      502,
      "Resposta de autenticação do Banco Inter inválida",
      "INTER_AUTH_INVALID_RESPONSE",
    );
  }

  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_SAFETY_MARGIN_MS,
  };

  return accessToken;
}

function toInterPaymentError(error: unknown, fallbackMessage: string): InterPaymentError {
  if (error instanceof AxiosError) {
    const status = error.response?.status ?? 502;
    return new InterPaymentError(
      status >= 400 && status < 600 ? status : 502,
      fallbackMessage,
      "INTER_API_ERROR",
    );
  }
  return new InterPaymentError(502, fallbackMessage, "INTER_API_UNAVAILABLE");
}

export async function interRequest<T>(
  path: string,
  method: InterHttpMethod,
  body?: Record<string, unknown>,
): Promise<T> {
  const config = getInterConfig();
  const accessToken = await getInterAccessToken(config);
  const client = getInterAxiosClient(config);

  try {
    const response = await client.request<T>({
      url: path,
      method,
      headers: { Authorization: `Bearer ${accessToken}` },
      data: body,
    });
    return response.data;
  } catch (error) {
    throw toInterPaymentError(error, "Falha na comunicação com o Banco Inter");
  }
}

export function resetInterClientCacheForTests(): void {
  cachedAgent = null;
  cachedClient = null;
  cachedToken = null;
}
