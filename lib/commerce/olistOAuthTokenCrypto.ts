import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Independent implementation, not a shared module with checkoutPii.ts --
// deliberately: different secret domains (OAuth tokens vs. customer PII)
// should not share a code path whose failure mode could couple them
// (olist-integration-design.md Section 14, olist-oauth-flow-design.md
// Section 4). Mirrors the same technique: AES-256-GCM, envelope versioned,
// key material rotatable by keyId, AAD binding the ciphertext to a context
// so a row copied elsewhere can't decrypt.

export type OlistOAuthKeyProvider = {
  currentKeyId(): string;
  encryptionKey(keyId: string): Buffer;
};

export type EncryptedOlistOAuthToken = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyId: string;
  envelopeVersion: number;
};

export const OLIST_OAUTH_TOKEN_ENVELOPE_VERSION = 1;

function aad(context: { provider: string; app: string; environment: string; tokenKind: "access" | "refresh"; keyId: string }): Buffer {
  return Buffer.from(
    JSON.stringify({
      purpose: "persi.olist.oauth-token",
      provider: context.provider,
      app: context.app,
      environment: context.environment,
      tokenKind: context.tokenKind,
      keyId: context.keyId,
    }),
    "utf8",
  );
}

export function encryptOlistOAuthToken(input: {
  plaintext: string;
  context: { provider: string; app: string; environment: string; tokenKind: "access" | "refresh" };
  keys: OlistOAuthKeyProvider;
  random?: (size: number) => Buffer;
}): EncryptedOlistOAuthToken {
  const keyId = input.keys.currentKeyId();
  const key = input.keys.encryptionKey(keyId);
  if (key.byteLength !== 32) throw new Error("OLIST_OAUTH_KEY_INVALID");
  const iv = (input.random ?? randomBytes)(12);
  if (iv.byteLength !== 12) throw new Error("OLIST_OAUTH_IV_INVALID");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad({ ...input.context, keyId }));
  const ciphertext = Buffer.concat([cipher.update(input.plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    keyId,
    envelopeVersion: OLIST_OAUTH_TOKEN_ENVELOPE_VERSION,
  };
}

export function decryptOlistOAuthToken(input: {
  encrypted: EncryptedOlistOAuthToken;
  context: { provider: string; app: string; environment: string; tokenKind: "access" | "refresh" };
  keys: OlistOAuthKeyProvider;
}): string {
  const key = input.keys.encryptionKey(input.encrypted.keyId);
  if (key.byteLength !== 32) throw new Error("OLIST_OAUTH_KEY_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(input.encrypted.iv, "base64url"));
  decipher.setAAD(aad({ ...input.context, keyId: input.encrypted.keyId }));
  decipher.setAuthTag(Buffer.from(input.encrypted.authTag, "base64url"));
  try {
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(input.encrypted.ciphertext, "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    throw new Error("OLIST_OAUTH_TOKEN_TAMPERED");
  }
}

function decodeSecret(value: string | undefined, error: string): Buffer {
  if (!value?.trim()) throw new Error(error);
  const decoded = Buffer.from(value.trim(), "base64url");
  if (decoded.byteLength !== 32) throw new Error(error);
  return decoded;
}

// Same per-key-variable fallback shape as checkoutPii.ts's
// perKeyEnvVarName -- proven necessary in staging (2026-09-25) because a
// hosting panel's env-var editor mangled a pasted JSON value's leading
// `{"`. `<KEYID>` is `keyId` upper-cased with non [A-Z0-9_] chars replaced.
function perKeyEnvVarName(keyId: string): string {
  return `OLIST_OAUTH_ENCRYPTION_KEY_${keyId.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
}

export function environmentOlistOAuthKeys(environment: NodeJS.ProcessEnv = process.env): OlistOAuthKeyProvider {
  const keyId = environment.OLIST_OAUTH_KEY_ID?.trim();
  if (!keyId || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(keyId)) throw new Error("OLIST_OAUTH_KEY_ID_INVALID");

  let jsonKeys: Record<string, unknown> | null = null;
  const rawJson = environment.OLIST_OAUTH_ENCRYPTION_KEYS_JSON?.trim();
  if (rawJson) {
    try {
      const parsed: unknown = JSON.parse(rawJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) jsonKeys = parsed as Record<string, unknown>;
    } catch {
      // Deliberately swallowed -- falls through to the per-key variable.
    }
  }

  return {
    currentKeyId: () => keyId,
    encryptionKey: (requested) => {
      const fromJson = jsonKeys?.[requested];
      if (typeof fromJson === "string") return decodeSecret(fromJson, "OLIST_OAUTH_KEY_INVALID");
      const fromPerKeyVar = environment[perKeyEnvVarName(requested)];
      if (typeof fromPerKeyVar === "string" && fromPerKeyVar.trim()) return decodeSecret(fromPerKeyVar, "OLIST_OAUTH_KEY_INVALID");
      throw new Error("OLIST_OAUTH_UNKNOWN_KEY");
    },
  };
}
