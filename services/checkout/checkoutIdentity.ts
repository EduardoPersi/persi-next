import { createHmac, randomUUID } from "node:crypto";

export type CheckoutIdentityRoute =
  | "/checkout-auth/health"
  | "/checkout-auth/identify"
  | "/checkout-auth/password"
  | "/checkout-auth/code/request"
  | "/checkout-auth/code/verify";

export interface CheckoutIdentityServiceResult {
  status: number;
  body: unknown;
  retryAfter?: string;
  durationMs: number;
}

export type CheckoutIdentityFailureCategory =
  | "configuration"
  | "timeout"
  | "network";

export class CheckoutIdentityServiceError extends Error {
  readonly category: CheckoutIdentityFailureCategory;
  readonly durationMs?: number;

  constructor(
    category: CheckoutIdentityFailureCategory,
    message: string,
    durationMs?: number,
  ) {
    super(message);
    this.name = "CheckoutIdentityServiceError";
    this.category = category;
    this.durationMs = durationMs;
  }
}

export function createCheckoutIdentitySignature(input: {
  secret: string;
  timestamp: string;
  nonce: string;
  method: "POST";
  restRoute: string;
  clientFingerprint: string;
  rawBody: string;
}): string {
  const canonical = [
    input.timestamp,
    input.nonce,
    input.method,
    input.restRoute,
    input.clientFingerprint,
    input.rawBody,
  ].join("\n");
  return createHmac("sha256", input.secret).update(canonical, "utf8").digest("hex");
}

export function getCheckoutIdentityDiagnostics(environment: NodeJS.ProcessEnv = process.env) {
  const wordpress = environment.WORDPRESS_URL?.trim() ?? "";
  let endpointHost = "";
  let endpointOrigin = "";
  try {
    const parsed = wordpress ? new URL(wordpress) : null;
    endpointHost = parsed?.host ?? "";
    endpointOrigin = parsed?.origin ?? "";
  } catch {}
  return {
    wordpressUrlConfigured: Boolean(wordpress),
    endpointHost,
    endpointOrigin,
    secretConfigured: (environment.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET?.trim().length ?? 0) >= 32,
    keyId: environment.PERSI_HEADLESS_CHECKOUT_AUTH_KEY_ID?.trim() || "primary",
  };
}

function configuration() {
  const wordpress = process.env.WORDPRESS_URL?.trim();
  const secret = process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET?.trim();
  const keyId = process.env.PERSI_HEADLESS_CHECKOUT_AUTH_KEY_ID?.trim() || "primary";
  if (!wordpress || !secret || secret.length < 32) {
    throw new CheckoutIdentityServiceError("configuration", "Checkout identity configuration is unavailable");
  }
  const endpoint = new URL(wordpress);
  if (!/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new CheckoutIdentityServiceError("configuration", "Checkout identity configuration is invalid");
  }
  return { endpoint: endpoint.toString().replace(/\/$/, ""), secret, keyId };
}

export async function requestCheckoutIdentity(
  route: CheckoutIdentityRoute,
  rawBody: string,
  clientFingerprint: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<CheckoutIdentityServiceResult> {
  const config = configuration();
  const path = `/wp-json/persi-headless/v1${route}`;
  const restRoute = `/persi-headless/v1${route}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const signature = createCheckoutIdentitySignature({
    secret: config.secret,
    timestamp,
    nonce,
    method: "POST",
    restRoute,
    clientFingerprint,
    rawBody,
  });

  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetchImplementation(`${config.endpoint}${path}`, {
      method: "POST",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Persi-Key-Id": config.keyId,
        "X-Persi-Timestamp": timestamp,
        "X-Persi-Nonce": nonce,
        "X-Persi-Signature": signature,
        "X-Persi-Client-Fingerprint": clientFingerprint,
      },
      body: rawBody,
    });
  } catch (error) {
    throw new CheckoutIdentityServiceError(
      error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
        ? "timeout"
        : "network",
      "Checkout identity request failed",
      Math.round(performance.now() - startedAt),
    );
  }

  return {
    status: response.status,
    body: await response.json().catch(() => null),
    retryAfter: response.headers.get("retry-after") ?? undefined,
    durationMs: Math.round(performance.now() - startedAt),
  };
}
