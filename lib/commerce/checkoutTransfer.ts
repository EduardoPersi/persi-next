import {
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { validateCheckoutTransferUrl } from "./checkoutTransferUrl.ts";
import type { CheckoutStoreAddress } from "../../types/checkout.ts";

export const CHECKOUT_TRANSFER_PATH =
  "/wp-json/persi-headless/v1/checkout-transfer";
export const CHECKOUT_TRANSFER_METHOD = "POST";

export interface CheckoutTransferItem {
  productId: number;
  variationId: number;
  quantity: number;
}

export interface CheckoutTransferPayload {
  items: CheckoutTransferItem[];
  couponCodes: [];
  shippingMethod: {
    rateId: "";
    packageIndex: 0;
  };
  billingAddress: CheckoutStoreAddress;
  shippingAddress: CheckoutStoreAddress;
}

export interface CheckoutTransferConfig {
  endpoint: string;
  keyId: string;
  origin: string;
  secret: string;
}

export interface SignedCheckoutTransferRequest {
  rawBody: string;
  canonicalRequest: string;
  headers: Record<string, string>;
}

export interface CheckoutTransferSuccess {
  transferUrl: string;
  expiresAt: string;
}

export class CheckoutTransferError extends Error {
  readonly status: number;
  readonly diagnosticCode: CheckoutDiagnosticCode;

  constructor(
    status: number,
    message: string,
    diagnosticCode: CheckoutDiagnosticCode = "CHECKOUT_RESPONSE_INVALID",
  ) {
    super(message);
    this.status = status;
    this.diagnosticCode = diagnosticCode;
    this.name = "CheckoutTransferError";
  }
}

export type CheckoutDiagnosticCode =
  | "CHECKOUT_CONFIG_MISSING"
  | "CHECKOUT_ORIGIN_INVALID"
  | "CHECKOUT_WORDPRESS_401"
  | "CHECKOUT_WORDPRESS_403"
  | "CHECKOUT_WORDPRESS_404"
  | "CHECKOUT_WORDPRESS_UNAVAILABLE"
  | "CHECKOUT_RESPONSE_INVALID";

function requireEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: keyof NodeJS.ProcessEnv,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new CheckoutTransferError(
      503,
      `Missing server configuration: ${name}`,
      "CHECKOUT_CONFIG_MISSING",
    );
  }
  return value;
}

function validateEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new CheckoutTransferError(
      503,
      "Invalid checkout transfer endpoint",
      "CHECKOUT_CONFIG_MISSING",
    );
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "loja.persimateriais.com.br" ||
    endpoint.pathname !== CHECKOUT_TRANSFER_PATH ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new CheckoutTransferError(
      503,
      "Invalid checkout transfer endpoint",
      "CHECKOUT_CONFIG_MISSING",
    );
  }

  return endpoint.toString();
}

function validateOrigin(value: string): string {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new CheckoutTransferError(
      503,
      "Invalid checkout transfer origin",
      "CHECKOUT_ORIGIN_INVALID",
    );
  }

  if (
    origin.protocol !== "https:" ||
    origin.origin !== value.replace(/\/$/, "") ||
    origin.username ||
    origin.password
  ) {
    throw new CheckoutTransferError(
      503,
      "Invalid checkout transfer origin",
      "CHECKOUT_ORIGIN_INVALID",
    );
  }

  return origin.origin;
}

export function getCheckoutTransferConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CheckoutTransferConfig {
  const secret = requireEnvironmentValue(
    environment,
    "PERSI_HEADLESS_CHECKOUT_HMAC_SECRET",
  );
  const keyId = requireEnvironmentValue(
    environment,
    "PERSI_HEADLESS_CHECKOUT_HMAC_KEY_ID",
  );
  const origin = requireEnvironmentValue(
    environment,
    "PERSI_HEADLESS_CHECKOUT_ORIGIN",
  );
  const endpoint = requireEnvironmentValue(
    environment,
    "PERSI_HEADLESS_CHECKOUT_ENDPOINT",
  );

  if (!/^[A-Za-z0-9._-]{1,40}$/.test(keyId)) {
    throw new CheckoutTransferError(
      503,
      "Invalid checkout transfer key id",
      "CHECKOUT_CONFIG_MISSING",
    );
  }

  return {
    endpoint: validateEndpoint(endpoint),
    keyId,
    origin: validateOrigin(origin),
    secret,
  };
}

function requireStoreAddressField(
  value: string | undefined,
  field: string,
): string {
  if (!value || !value.trim()) {
    throw new CheckoutTransferError(422, `Missing address field: ${field}`);
  }
  return value.trim();
}

function validateStoreAddress(
  address: CheckoutStoreAddress,
): CheckoutStoreAddress {
  return {
    firstName: requireStoreAddressField(address.firstName, "firstName"),
    lastName: requireStoreAddressField(address.lastName, "lastName"),
    company: address.company?.trim() || undefined,
    address1: requireStoreAddressField(address.address1, "address1"),
    address2: address.address2?.trim() || undefined,
    city: requireStoreAddressField(address.city, "city"),
    state: requireStoreAddressField(address.state, "state").toUpperCase(),
    postcode: requireStoreAddressField(address.postcode, "postcode").replace(
      /\D/g,
      "",
    ),
    country: "BR",
    ...(address.email || address.phone
      ? {
          email: address.email
            ? requireStoreAddressField(address.email, "email")
            : undefined,
          phone: address.phone
            ? requireStoreAddressField(address.phone, "phone").replace(
                /\D/g,
                "",
              )
            : undefined,
        }
      : {}),
  };
}

export function buildCheckoutTransferPayload(
  items: CheckoutTransferItem[],
  customer: { billingAddress: CheckoutStoreAddress; shippingAddress: CheckoutStoreAddress },
): CheckoutTransferPayload {
  if (items.length < 1 || items.length > 100) {
    throw new CheckoutTransferError(422, "Cart cannot be transferred");
  }

  const validatedItems = items.map((item) => {
    if (
      !Number.isInteger(item.productId) ||
      item.productId < 1 ||
      !Number.isInteger(item.variationId) ||
      item.variationId < 0 ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 999
    ) {
      throw new CheckoutTransferError(422, "Cart contains an invalid item");
    }

    return {
      productId: item.productId,
      variationId: item.variationId,
      quantity: item.quantity,
    };
  });

  return {
    items: validatedItems,
    couponCodes: [],
    shippingMethod: {
      rateId: "",
      packageIndex: 0,
    },
    billingAddress: validateStoreAddress(customer.billingAddress),
    shippingAddress: validateStoreAddress(customer.shippingAddress),
  };
}

export function buildCanonicalCheckoutTransferRequest(input: {
  rawBody: string;
  timestamp: string;
  nonce: string;
  origin: string;
}): string {
  const bodyHash = createHash("sha256")
    .update(input.rawBody, "utf8")
    .digest("hex");

  return [
    CHECKOUT_TRANSFER_METHOD,
    CHECKOUT_TRANSFER_PATH,
    input.timestamp,
    input.nonce,
    input.origin,
    bodyHash,
  ].join("\n");
}

export function signCheckoutTransferRequest(
  payload: CheckoutTransferPayload,
  config: CheckoutTransferConfig,
  options: {
    timestamp?: string;
    nonce?: string;
  } = {},
): SignedCheckoutTransferRequest {
  const rawBody = JSON.stringify(payload);
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? randomBytes(16).toString("base64url");
  const canonicalRequest = buildCanonicalCheckoutTransferRequest({
    rawBody,
    timestamp,
    nonce,
    origin: config.origin,
  });
  const signature = createHmac("sha256", config.secret)
    .update(canonicalRequest, "utf8")
    .digest("hex");

  return {
    rawBody,
    canonicalRequest,
    headers: {
      "Content-Type": "application/json",
      "X-Persi-Key-Id": config.keyId,
      "X-Persi-Timestamp": timestamp,
      "X-Persi-Nonce": nonce,
      "X-Persi-Origin": config.origin,
      "X-Persi-Signature": `v1=${signature}`,
    },
  };
}

export function parseCheckoutTransferResponse(
  value: unknown,
): CheckoutTransferSuccess {
  if (!value || typeof value !== "object") {
    throw new CheckoutTransferError(
      502,
      "Invalid checkout transfer response",
      "CHECKOUT_RESPONSE_INVALID",
    );
  }

  const response = value as Record<string, unknown>;
  const transferUrl = validateCheckoutTransferUrl(response.transferUrl);
  const expiresAt =
    typeof response.expiresAt === "string" &&
    Number.isFinite(Date.parse(response.expiresAt))
      ? response.expiresAt
      : null;

  if (!transferUrl || !expiresAt) {
    throw new CheckoutTransferError(
      502,
      "Invalid checkout transfer response",
      "CHECKOUT_RESPONSE_INVALID",
    );
  }

  return { transferUrl, expiresAt };
}

export async function createCheckoutTransfer(
  payload: CheckoutTransferPayload,
  config: CheckoutTransferConfig,
  fetchImplementation: typeof fetch = fetch,
): Promise<CheckoutTransferSuccess> {
  const signedRequest = signCheckoutTransferRequest(payload, config);
  let response: Response;

  try {
    response = await fetchImplementation(config.endpoint, {
      method: CHECKOUT_TRANSFER_METHOD,
      headers: signedRequest.headers,
      body: signedRequest.rawBody,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CheckoutTransferError(
      502,
      "Checkout transfer request failed",
      "CHECKOUT_WORDPRESS_UNAVAILABLE",
    );
  }

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    const status = [401, 409, 422, 503].includes(response.status)
      ? response.status
      : 502;
    const diagnosticCode =
      response.status === 401
        ? "CHECKOUT_WORDPRESS_401"
        : response.status === 403
          ? "CHECKOUT_WORDPRESS_403"
          : response.status === 404
            ? "CHECKOUT_WORDPRESS_404"
            : "CHECKOUT_RESPONSE_INVALID";
    throw new CheckoutTransferError(
      status,
      "Checkout transfer was rejected",
      diagnosticCode,
    );
  }

  return parseCheckoutTransferResponse(responseBody);
}
