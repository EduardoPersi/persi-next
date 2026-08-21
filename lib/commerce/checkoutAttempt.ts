import { createHash, createHmac, randomBytes } from "node:crypto";
import { getCheckoutTransferConfig } from "./checkoutTransfer.ts";

export const CHECKOUT_ATTEMPT_PATH = "/wp-json/persi-headless/v1/checkout-attempt";

export type CheckoutAttemptState =
  | "RESERVED"
  | "ORDER_CREATED"
  | "PAYMENT_CREATING"
  | "PAYMENT_CREATED"
  | "PAYMENT_PENDING"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_FAILED"
  | "CANCELLED";

export interface CheckoutAttempt {
  checkout_attempt_id: string;
  order_id: string | null;
  payment_provider: string;
  payment_method: string;
  provider_reference: string | null;
  state: CheckoutAttemptState;
  updated_at: string;
}

export interface AttemptReservation {
  acquired: boolean;
  lease_token: string | null;
  attempt: CheckoutAttempt;
}

async function callAttemptEndpoint<T>(payload: object, fetcher: typeof fetch = fetch): Promise<T> {
  const config = getCheckoutTransferConfig();
  const endpoint = new URL(config.endpoint);
  endpoint.pathname = CHECKOUT_ATTEMPT_PATH;
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("base64url");
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const canonical = ["POST", CHECKOUT_ATTEMPT_PATH, timestamp, nonce, config.origin, bodyHash].join("\n");
  const signature = createHmac("sha256", config.secret).update(canonical).digest("hex");
  const response = await fetcher(endpoint, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "content-type": "application/json",
      "x-persi-key-id": config.keyId,
      "x-persi-timestamp": timestamp,
      "x-persi-nonce": nonce,
      "x-persi-origin": config.origin,
      "x-persi-signature": `v1=${signature}`,
    },
    body: rawBody,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(`Checkout attempt rejected (${response.status})`);
  return result as T;
}

export function reserveCheckoutAttempt(checkoutAttemptId: string, paymentMethod: string) {
  return callAttemptEndpoint<AttemptReservation>({ action: "reserve", checkout_attempt_id: checkoutAttemptId, payment_method: paymentMethod });
}

export function getCheckoutAttempt(checkoutAttemptId: string) {
  return callAttemptEndpoint<{ attempt: CheckoutAttempt }>({
    action: "get",
    checkout_attempt_id: checkoutAttemptId,
  }).then(({ attempt }) => attempt);
}

export function transitionCheckoutAttempt(input: {
  checkoutAttemptId: string;
  leaseToken: string;
  from: CheckoutAttemptState;
  to: CheckoutAttemptState;
  orderId?: number;
  providerReference?: string;
}) {
  return callAttemptEndpoint<{ updated: true; attempt: CheckoutAttempt }>({
    action: "transition",
    checkout_attempt_id: input.checkoutAttemptId,
    lease_token: input.leaseToken,
    from: input.from,
    to: input.to,
    ...(input.orderId ? { order_id: input.orderId } : {}),
    ...(input.providerReference ? { provider_reference: input.providerReference } : {}),
  });
}

export function reconcileCheckoutAttempt(
  providerReference: string,
  state: "PAYMENT_CONFIRMED" | "PAYMENT_FAILED",
) {
  return callAttemptEndpoint<{ updated: boolean }>({
    action: "reconcile",
    provider_reference: providerReference,
    to: state,
  });
}
