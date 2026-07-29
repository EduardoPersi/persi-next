const EXPECTED_ORIGIN =
  "https://app.persimateriais.com.br";
const EXPECTED_ENDPOINT =
  "https://persimateriais.com.br/wp-json/persi-account/v1";

function isStrictOrigin(value) {
  if (!value || value !== value.trim() || value.endsWith("/")) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.origin === value &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isStrictEndpoint(value) {
  if (!value || value !== value.trim() || value.endsWith("/")) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "persimateriais.com.br" &&
      url.pathname === "/wp-json/persi-account/v1" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

const secret = process.env.PERSI_HEADLESS_ACCOUNT_HMAC_SECRET ?? "";
const keyId = process.env.PERSI_HEADLESS_ACCOUNT_HMAC_KEY_ID ?? "";
const origin = process.env.PERSI_HEADLESS_ACCOUNT_ORIGIN ?? "";
const endpoint = process.env.PERSI_HEADLESS_ACCOUNT_ENDPOINT ?? "";

const checks = {
  ACCOUNT_HMAC_SECRET_PRESENT: secret.length > 0,
  ACCOUNT_HMAC_SECRET_LENGTH_VALID: secret.length >= 32,
  ACCOUNT_KEY_ID_VALID: keyId === "primary",
  ACCOUNT_ORIGIN_VALID:
    isStrictOrigin(origin) && origin === EXPECTED_ORIGIN,
  ACCOUNT_ENDPOINT_VALID:
    isStrictEndpoint(endpoint) && endpoint === EXPECTED_ENDPOINT,
};

for (const [name, valid] of Object.entries(checks)) {
  console.log(`${name}=${valid}`);
}

process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
