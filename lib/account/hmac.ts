import { createHash, createHmac, randomBytes } from "node:crypto";

export type AccountHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface AccountHmacConfig {
  keyId: string;
  origin: string;
  secret: string;
}

export interface SignedAccountRequest {
  canonicalRequest: string;
  headers: Record<string, string>;
}

export function buildCanonicalAccountRequest(input: {
  method: AccountHttpMethod;
  path: string;
  timestamp: string;
  nonce: string;
  origin: string;
  rawBody: string;
}): string {
  const bodyHash = createHash("sha256")
    .update(input.rawBody, "utf8")
    .digest("hex");

  return [
    input.method,
    input.path,
    input.timestamp,
    input.nonce,
    input.origin,
    bodyHash,
  ].join("\n");
}

export function signAccountRequest(
  input: {
    method: AccountHttpMethod;
    path: string;
    rawBody: string;
  },
  config: AccountHmacConfig,
  options: { timestamp?: string; nonce?: string } = {},
): SignedAccountRequest {
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? randomBytes(16).toString("base64url");
  const canonicalRequest = buildCanonicalAccountRequest({
    ...input,
    timestamp,
    nonce,
    origin: config.origin,
  });
  const signature = createHmac("sha256", config.secret)
    .update(canonicalRequest, "utf8")
    .digest("hex");

  return {
    canonicalRequest,
    headers: {
      "X-Persi-Key-Id": config.keyId,
      "X-Persi-Timestamp": timestamp,
      "X-Persi-Nonce": nonce,
      "X-Persi-Origin": config.origin,
      "X-Persi-Signature": `v1=${signature}`,
    },
  };
}
