import {
  signAccountRequest,
  type AccountHmacConfig,
  type AccountHttpMethod,
} from "../../lib/account/hmac.ts";

export const ACCOUNT_REST_BASE_PATH = "/wp-json/persi-account/v1";
export const OAUTH_REST_BASE_PATH =
  "/wp-json/persi-headless-account/v1";
export const CUSTOMER_LISTS_REST_BASE_PATH = "/wp-json/persi-headless/v1";

export interface AccountClientConfig extends AccountHmacConfig {
  endpoint: string;
}

export class AccountServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    message: string,
    code = "ACCOUNT_SERVICE_ERROR",
  ) {
    super(message);
    this.name = "AccountServiceError";
    this.status = status;
    this.code = code;
  }
}

function requireEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name:
    | "PERSI_HEADLESS_ACCOUNT_HMAC_SECRET"
    | "PERSI_HEADLESS_ACCOUNT_HMAC_KEY_ID"
    | "PERSI_HEADLESS_ACCOUNT_ORIGIN"
    | "PERSI_HEADLESS_ACCOUNT_ENDPOINT",
): string {
  const value = environment[name]?.trim();
  if (!value) throw new AccountServiceError(503, "Missing account configuration");
  return value;
}

function validateOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AccountServiceError(503, "Invalid account origin");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== value.replace(/\/$/, "") ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new AccountServiceError(503, "Invalid account origin");
  }
  return parsed.origin;
}

function validateEndpoint(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AccountServiceError(503, "Invalid account endpoint");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "persimateriais.com.br" ||
    parsed.pathname.replace(/\/$/, "") !== ACCOUNT_REST_BASE_PATH ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new AccountServiceError(503, "Invalid account endpoint");
  }
  return `${parsed.origin}${ACCOUNT_REST_BASE_PATH}`;
}

export function getAccountClientConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AccountClientConfig {
  const keyId = requireEnvironmentValue(
    environment,
    "PERSI_HEADLESS_ACCOUNT_HMAC_KEY_ID",
  );
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(keyId)) {
    throw new AccountServiceError(503, "Invalid account key id");
  }

  return {
    secret: requireEnvironmentValue(
      environment,
      "PERSI_HEADLESS_ACCOUNT_HMAC_SECRET",
    ),
    keyId,
    origin: validateOrigin(
      requireEnvironmentValue(
        environment,
        "PERSI_HEADLESS_ACCOUNT_ORIGIN",
      ),
    ),
    endpoint: validateEndpoint(
      requireEnvironmentValue(
        environment,
        "PERSI_HEADLESS_ACCOUNT_ENDPOINT",
      ),
    ),
  };
}

export async function requestAccountEndpoint(input: {
  config: AccountClientConfig;
  method: AccountHttpMethod;
  route: "/login" | "/google-login" | "/oauth-login" | "/session" | "/logout" | "/register" | "/forgot-password" | "/reset-password" | "/orders" | `/orders/${number}` | `/customer-lists/${string}` | `/customer-lists/${string}/${number}` | `/customer-lists/${string}/sync`;
  basePath?: typeof ACCOUNT_REST_BASE_PATH | typeof OAUTH_REST_BASE_PATH | typeof CUSTOMER_LISTS_REST_BASE_PATH;
  query?: string;
  rawBody: string;
  sessionToken?: string;
  fetchImplementation?: typeof fetch;
}): Promise<{ status: number; body: unknown; retryAfter?: string }> {
  const basePath = input.basePath ?? ACCOUNT_REST_BASE_PATH;
  const path = `${basePath}${input.route}`;
  const signed = signAccountRequest(
    { method: input.method, path, rawBody: input.rawBody },
    input.config,
  );
  const headers: Record<string, string> = { ...signed.headers };
  if (input.rawBody) headers["Content-Type"] = "application/json";
  if (input.sessionToken) headers["X-Persi-Session"] = input.sessionToken;

  let response: Response;
  try {
    response = await (input.fetchImplementation ?? fetch)(
      `${new URL(input.config.endpoint).origin}${path}${input.query ? `?${input.query}` : ""}`,
      {
        method: input.method,
        headers,
        body: input.method === "GET" || input.method === "DELETE" ? undefined : input.rawBody || undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new AccountServiceError(502, "Account service unavailable");
  }

  return {
    status: response.status,
    body: await response.json().catch(() => null),
    retryAfter: response.headers.get("retry-after") ?? undefined,
  };
}
