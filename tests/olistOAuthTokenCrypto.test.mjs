import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptOlistOAuthToken,
  encryptOlistOAuthToken,
  environmentOlistOAuthKeys,
} from "../lib/commerce/olistOAuthTokenCrypto.ts";

const KEY_A = Buffer.alloc(32, 7).toString("base64url");
const KEY_B = Buffer.alloc(32, 9).toString("base64url");

function fakeKeys(overrides = {}) {
  const keys = { primary: KEY_A, ...overrides };
  return {
    currentKeyId: () => "primary",
    encryptionKey: (id) => {
      if (!(id in keys)) throw new Error("OLIST_OAUTH_UNKNOWN_KEY");
      return Buffer.from(keys[id], "base64url");
    },
  };
}

const context = { provider: "olist", app: "catalogo", environment: "staging", tokenKind: "access" };

test("encryptOlistOAuthToken/decryptOlistOAuthToken round-trip", () => {
  const keys = fakeKeys();
  const encrypted = encryptOlistOAuthToken({ plaintext: "super-secret-token", context, keys });
  assert.equal(encrypted.keyId, "primary");
  assert.equal(encrypted.envelopeVersion, 1);
  const decrypted = decryptOlistOAuthToken({ encrypted, context, keys });
  assert.equal(decrypted, "super-secret-token");
});

test("decryptOlistOAuthToken fails closed when the AAD context differs (wrong app/environment)", () => {
  const keys = fakeKeys();
  const encrypted = encryptOlistOAuthToken({ plaintext: "super-secret-token", context, keys });
  assert.throws(
    () => decryptOlistOAuthToken({ encrypted, context: { ...context, app: "pedidos" }, keys }),
    /OLIST_OAUTH_TOKEN_TAMPERED/,
  );
});

test("decryptOlistOAuthToken fails closed on a tampered ciphertext", () => {
  const keys = fakeKeys();
  const encrypted = encryptOlistOAuthToken({ plaintext: "super-secret-token", context, keys });
  const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -2) + "aa" };
  assert.throws(() => decryptOlistOAuthToken({ encrypted: tampered, context, keys }), /OLIST_OAUTH_TOKEN_TAMPERED/);
});

test("a second key id can decrypt an envelope encrypted under it (key rotation)", () => {
  const keys = fakeKeys({ secondary: KEY_B });
  const rotated = { ...keys, currentKeyId: () => "secondary" };
  const encrypted = encryptOlistOAuthToken({ plaintext: "rotated-token", context, keys: rotated });
  assert.equal(encrypted.keyId, "secondary");
  assert.equal(decryptOlistOAuthToken({ encrypted, context, keys }), "rotated-token");
});

test("environmentOlistOAuthKeys reads OLIST_OAUTH_ENCRYPTION_KEYS_JSON", () => {
  const provider = environmentOlistOAuthKeys({
    OLIST_OAUTH_KEY_ID: "primary",
    OLIST_OAUTH_ENCRYPTION_KEYS_JSON: JSON.stringify({ primary: KEY_A }),
  });
  assert.equal(provider.currentKeyId(), "primary");
  assert.deepEqual(provider.encryptionKey("primary"), Buffer.from(KEY_A, "base64url"));
});

test("environmentOlistOAuthKeys falls back to a per-key variable when the JSON is missing/mangled", () => {
  const provider = environmentOlistOAuthKeys({
    OLIST_OAUTH_KEY_ID: "k1",
    OLIST_OAUTH_ENCRYPTION_KEYS_JSON: "not json at all",
    OLIST_OAUTH_ENCRYPTION_KEY_K1: KEY_A,
  });
  assert.deepEqual(provider.encryptionKey("k1"), Buffer.from(KEY_A, "base64url"));
});

test("environmentOlistOAuthKeys throws OLIST_OAUTH_KEY_ID_INVALID when unset", () => {
  assert.throws(() => environmentOlistOAuthKeys({}), /OLIST_OAUTH_KEY_ID_INVALID/);
});
