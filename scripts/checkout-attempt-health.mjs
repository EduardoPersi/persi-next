import { createHash, createHmac, randomBytes } from "node:crypto";

const endpoint = process.env.PERSI_HEADLESS_CHECKOUT_ATTEMPT_ENDPOINT;
const secret = process.env.PERSI_HEADLESS_CHECKOUT_HMAC_SECRET;
const keyId = process.env.PERSI_HEADLESS_CHECKOUT_HMAC_KEY_ID || "primary";
const origin = process.env.PERSI_HEADLESS_CHECKOUT_ORIGIN;
const path = "/wp-json/persi-headless/v1/checkout-attempt";

if (!endpoint || !secret || !origin) {
  console.error("Configure PERSI_HEADLESS_CHECKOUT_ATTEMPT_ENDPOINT, PERSI_HEADLESS_CHECKOUT_HMAC_SECRET e PERSI_HEADLESS_CHECKOUT_ORIGIN.");
  process.exit(1);
}

const parsedEndpoint = new URL(endpoint);
if (parsedEndpoint.pathname !== path || parsedEndpoint.protocol !== "https:") {
  console.error(`O endpoint deve ser HTTPS e terminar em ${path}.`);
  process.exit(1);
}

const rawBody = JSON.stringify({ action: "health" });
const timestamp = String(Math.floor(Date.now() / 1000));
const nonce = randomBytes(16).toString("base64url");
const bodyHash = createHash("sha256").update(rawBody).digest("hex");
const canonical = ["POST", path, timestamp, nonce, origin, bodyHash].join("\n");
const signature = createHmac("sha256", secret).update(canonical).digest("hex");
const startedAt = performance.now();
const response = await fetch(parsedEndpoint, {
  method: "POST",
  cache: "no-store",
  headers: {
    "content-type": "application/json",
    "x-persi-key-id": keyId,
    "x-persi-timestamp": timestamp,
    "x-persi-nonce": nonce,
    "x-persi-origin": origin,
    "x-persi-signature": `v1=${signature}`,
  },
  body: rawBody,
});
const result = await response.json().catch(() => null);
console.log({
  status: response.status,
  durationMs: Math.round(performance.now() - startedAt),
  healthy: result?.healthy === true,
  tableExists: result?.table_exists === true,
  uniqueCheckoutAttemptId: result?.unique_checkout_attempt_id === true,
  databaseVersion: result?.database_version,
  expectedDatabaseVersion: result?.expected_database_version,
});
if (!response.ok || result?.healthy !== true) process.exit(1);
