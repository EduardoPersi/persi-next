export const ACCOUNT_REST_BASE_PATH = "/wp-json/persi-account/v1";
export const OAUTH_REST_BASE_PATH = "/wp-json/persi-auth/v1";
export const CUSTOMER_LISTS_REST_BASE_PATH = "/wp-json/persi-headless/v1";

export interface AccountClientConfig {
  endpoint: string;
  origin: string;
}

export class AccountServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "ACCOUNT_SERVICE_ERROR") {
    super(message);
    this.name = "AccountServiceError";
    this.status = status;
    this.code = code;
  }
}

export function getAccountClientConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AccountClientConfig {
  const wordpress = environment.WORDPRESS_URL?.trim();
  const applicationOrigin = environment.PERSI_HEADLESS_ACCOUNT_ORIGIN?.trim();
  if (!wordpress || !applicationOrigin) {
    throw new AccountServiceError(503, "Missing account configuration");
  }
  try {
    const endpoint = new URL(wordpress);
    const origin = new URL(applicationOrigin);
    if (!/^https?:$/.test(endpoint.protocol) || !/^https?:$/.test(origin.protocol)) {
      throw new Error();
    }
    return {
      endpoint: endpoint.toString().replace(/\/$/, ""),
      origin: origin.origin,
    };
  } catch {
    throw new AccountServiceError(503, "Invalid account configuration");
  }
}

export async function requestAccountEndpoint(input: {
  config: AccountClientConfig;
  method: "GET" | "POST" | "PUT" | "DELETE";
  route: `/${string}`;
  basePath?: typeof ACCOUNT_REST_BASE_PATH | typeof OAUTH_REST_BASE_PATH | typeof CUSTOMER_LISTS_REST_BASE_PATH;
  query?: string;
  rawBody: string;
  bearerToken?: string;
  fetchImplementation?: typeof fetch;
}): Promise<{ status: number; body: unknown; retryAfter?: string }> {
  const basePath = input.basePath ?? ACCOUNT_REST_BASE_PATH;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (input.rawBody) headers["Content-Type"] = "application/json";
  if (input.bearerToken) headers.Authorization = `Bearer ${input.bearerToken}`;

  try {
    const response = await (input.fetchImplementation ?? fetch)(
      `${input.config.endpoint}${basePath}${input.route}${input.query ? `?${input.query}` : ""}`,
      {
        method: input.method,
        headers,
        body: input.method === "GET" || input.method === "DELETE" ? undefined : input.rawBody || undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    return {
      status: response.status,
      body: await response.json().catch(() => null),
      retryAfter: response.headers.get("retry-after") ?? undefined,
    };
  } catch {
    throw new AccountServiceError(502, "Account service unavailable");
  }
}
