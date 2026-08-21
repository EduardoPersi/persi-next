import { createHmac, randomUUID } from "node:crypto";

export type CheckoutIdentityRoute =
  | "/checkout-auth/identify"
  | "/checkout-auth/password"
  | "/checkout-auth/code/request"
  | "/checkout-auth/code/verify";

export interface CheckoutIdentityServiceResult {
  status: number;
  body: unknown;
  retryAfter?: string;
}

function configuration() {
  const wordpress = process.env.WORDPRESS_URL?.trim();
  const secret = process.env.PERSI_HEADLESS_CHECKOUT_AUTH_SECRET?.trim();
  const keyId = process.env.PERSI_HEADLESS_CHECKOUT_AUTH_KEY_ID?.trim() || "primary";
  if (!wordpress || !secret || secret.length < 32) {
    throw new Error("Checkout identity configuration is unavailable");
  }
  const endpoint = new URL(wordpress);
  if (!/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("Checkout identity configuration is invalid");
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
  const canonical = [timestamp, nonce, "POST", restRoute, clientFingerprint, rawBody].join("\n");
  const signature = createHmac("sha256", config.secret)
    .update(canonical, "utf8")
    .digest("hex");

  const response = await fetchImplementation(`${config.endpoint}${path}`, {
    method: "POST",
    cache: "no-store",
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

  return {
    status: response.status,
    body: await response.json().catch(() => null),
    retryAfter: response.headers.get("retry-after") ?? undefined,
  };
}
