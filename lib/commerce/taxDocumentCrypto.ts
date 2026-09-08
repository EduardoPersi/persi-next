import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  decryptCheckoutPii,
  type CheckoutPiiKeyProvider,
  type EncryptedCheckoutPii,
} from "./checkoutPii";
import {
  detectBrazilianDocumentType,
  isValidBrazilianDocument,
  type BrazilianDocumentType,
} from "../validation/document";

export const DURABLE_TAX_DOCUMENT_VERSION = 1;
export const DURABLE_TAX_DOCUMENT_PURPOSE = "persi.order.tax-document";
export const DURABLE_TAX_DOCUMENT_FINGERPRINT_PURPOSE =
  "persi.order.tax-document-fingerprint";

export type DurableTaxDocumentKeyProvider = {
  currentKeyId(): string;
  encryptionKey(keyId: string): Buffer;
  fingerprintKey(): Buffer;
};

export type CanonicalTaxDocument = {
  type: BrazilianDocumentType;
  value: string;
};

export type DurableTaxDocumentBundle = {
  type: BrazilianDocumentType;
  ciphertext: string;
  fingerprint: string;
  masked: string;
};

type DurableTaxDocumentEnvelope = {
  v: 1;
  kid: string;
  iv: string;
  tag: string;
  ct: string;
};

const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const CPF_MASK_PATTERN = /^\*{3}\.\*{3}\.\*{3}-\d{2}$/;
const CNPJ_MASK_PATTERN = /^\*{2}\.\*{3}\.\*{3}\/\*{4}-\d{2}$/;

function fail(code: string): never {
  throw new Error(code);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalizeTaxDocument(input: {
  type: BrazilianDocumentType;
  value: string;
}): CanonicalTaxDocument {
  if (input.type !== "cpf" && input.type !== "cnpj") fail("TAX_ID_INVALID");
  if (typeof input.value !== "string" || !input.value.trim()) fail("TAX_ID_INVALID");
  if (!/^[0-9.\-/\s]+$/.test(input.value)) fail("TAX_ID_INVALID");
  const value = input.value.replace(/\D/g, "");
  const detected = detectBrazilianDocumentType(value);
  if (detected !== input.type) fail("TAX_ID_TYPE_MISMATCH");
  if (!isValidBrazilianDocument(value)) fail("TAX_ID_INVALID");
  return { type: input.type, value };
}

export function maskTaxDocument(document: CanonicalTaxDocument): string {
  const suffix = document.value.slice(-2);
  return document.type === "cpf" ? `***.***.***-${suffix}` : `**.***.***/****-${suffix}`;
}

function aad(input: {
  storeId: string;
  orderId: string;
  type: BrazilianDocumentType;
  version: number;
  keyId: string;
}): Buffer {
  return Buffer.from(canonicalJson({
    purpose: DURABLE_TAX_DOCUMENT_PURPOSE,
    v: input.version,
    kid: input.keyId,
    storeId: input.storeId,
    orderId: input.orderId,
    type: input.type,
  }), "utf8");
}

function fingerprint(input: {
  storeId: string;
  document: CanonicalTaxDocument;
  key: Buffer;
}): string {
  if (input.key.byteLength < 32) fail("TAX_ID_HMAC_KEY_INVALID");
  return createHmac("sha256", input.key)
    .update(DURABLE_TAX_DOCUMENT_FINGERPRINT_PURPOSE, "utf8")
    .update("\0", "utf8")
    .update(canonicalJson({
      storeId: input.storeId,
      type: input.document.type,
      value: input.document.value,
    }), "utf8")
    .digest("hex");
}

function decodeBase64Url(value: string, expectedLength?: number): Buffer {
  if (!BASE64URL_PATTERN.test(value)) fail("TAX_ID_ENVELOPE_INVALID");
  const decoded = Buffer.from(value, "base64url");
  if (!decoded.byteLength || (expectedLength !== undefined && decoded.byteLength !== expectedLength)) {
    fail("TAX_ID_ENVELOPE_INVALID");
  }
  if (decoded.toString("base64url") !== value) fail("TAX_ID_ENVELOPE_INVALID");
  return decoded;
}

export function parseDurableTaxDocumentEnvelope(serialized: string): DurableTaxDocumentEnvelope {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { fail("TAX_ID_ENVELOPE_INVALID"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("TAX_ID_ENVELOPE_INVALID");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== "ct,iv,kid,tag,v") fail("TAX_ID_ENVELOPE_INVALID");
  if (record.v !== DURABLE_TAX_DOCUMENT_VERSION) fail("TAX_ID_VERSION_UNSUPPORTED");
  if (typeof record.kid !== "string" || !KEY_ID_PATTERN.test(record.kid)) fail("TAX_ID_ENVELOPE_INVALID");
  if (typeof record.iv !== "string" || typeof record.tag !== "string" || typeof record.ct !== "string") {
    fail("TAX_ID_ENVELOPE_INVALID");
  }
  decodeBase64Url(record.iv, 12);
  decodeBase64Url(record.tag, 16);
  decodeBase64Url(record.ct);
  return record as DurableTaxDocumentEnvelope;
}

function serializeEnvelope(envelope: DurableTaxDocumentEnvelope): string {
  return JSON.stringify({
    v: envelope.v,
    kid: envelope.kid,
    iv: envelope.iv,
    tag: envelope.tag,
    ct: envelope.ct,
  });
}

export function assertDurableTaxDocumentBundle(input: Partial<DurableTaxDocumentBundle>) {
  const absent = !input.type && !input.ciphertext && !input.fingerprint && !input.masked;
  if (absent) return null;
  if (input.type !== "cpf" && input.type !== "cnpj") fail("TAX_ID_ENVELOPE_INVALID");
  if (typeof input.ciphertext !== "string") fail("TAX_ID_ENVELOPE_INVALID");
  parseDurableTaxDocumentEnvelope(input.ciphertext);
  if (typeof input.fingerprint !== "string" || !HEX_64_PATTERN.test(input.fingerprint)) {
    fail("TAX_ID_ENVELOPE_INVALID");
  }
  const maskPattern = input.type === "cpf" ? CPF_MASK_PATTERN : CNPJ_MASK_PATTERN;
  if (typeof input.masked !== "string" || !maskPattern.test(input.masked)) fail("TAX_ID_ENVELOPE_INVALID");
  return input as DurableTaxDocumentBundle;
}

export function encryptDurableTaxDocument(input: {
  document: { type: BrazilianDocumentType; value: string };
  storeId: string;
  orderId: string;
  keys: DurableTaxDocumentKeyProvider;
  random?: (size: number) => Buffer;
}): DurableTaxDocumentBundle {
  const document = canonicalizeTaxDocument(input.document);
  const keyId = input.keys.currentKeyId();
  if (!KEY_ID_PATTERN.test(keyId)) fail("TAX_ID_KEY_ID_INVALID");
  let key: Buffer;
  try { key = input.keys.encryptionKey(keyId); } catch { fail("TAX_ID_KEY_UNKNOWN"); }
  if (key.byteLength !== 32) fail("TAX_ID_KEY_INVALID");
  const iv = (input.random ?? randomBytes)(12);
  if (iv.byteLength !== 12) fail("TAX_ID_IV_INVALID");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad({
    storeId: input.storeId,
    orderId: input.orderId,
    type: document.type,
    version: DURABLE_TAX_DOCUMENT_VERSION,
    keyId,
  }));
  const ciphertext = Buffer.concat([cipher.update(document.value, "utf8"), cipher.final()]);
  const envelope = serializeEnvelope({
    v: DURABLE_TAX_DOCUMENT_VERSION,
    kid: keyId,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ct: ciphertext.toString("base64url"),
  });
  return {
    type: document.type,
    ciphertext: envelope,
    fingerprint: fingerprint({ storeId: input.storeId, document, key: input.keys.fingerprintKey() }),
    masked: maskTaxDocument(document),
  };
}

export function decryptDurableTaxDocument(input: {
  bundle: DurableTaxDocumentBundle;
  storeId: string;
  orderId: string;
  keys: DurableTaxDocumentKeyProvider;
}): CanonicalTaxDocument {
  const bundle = assertDurableTaxDocumentBundle(input.bundle);
  if (!bundle) fail("TAX_ID_ENVELOPE_INVALID");
  const envelope = parseDurableTaxDocumentEnvelope(bundle.ciphertext);
  let key: Buffer;
  try { key = input.keys.encryptionKey(envelope.kid); } catch { fail("TAX_ID_KEY_UNKNOWN"); }
  if (key.byteLength !== 32) fail("TAX_ID_KEY_INVALID");
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, decodeBase64Url(envelope.iv, 12));
    decipher.setAAD(aad({
      storeId: input.storeId,
      orderId: input.orderId,
      type: bundle.type,
      version: envelope.v,
      keyId: envelope.kid,
    }));
    decipher.setAuthTag(decodeBase64Url(envelope.tag, 16));
    plaintext = Buffer.concat([decipher.update(decodeBase64Url(envelope.ct)), decipher.final()]);
  } catch { fail("TAX_ID_AUTH_FAILED"); }
  const document = canonicalizeTaxDocument({ type: bundle.type, value: plaintext.toString("utf8") });
  const expectedFingerprint = fingerprint({
    storeId: input.storeId,
    document,
    key: input.keys.fingerprintKey(),
  });
  const expected = Buffer.from(expectedFingerprint, "hex");
  const actual = Buffer.from(bundle.fingerprint, "hex");
  if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) {
    fail("TAX_ID_FINGERPRINT_MISMATCH");
  }
  if (maskTaxDocument(document) !== bundle.masked) fail("TAX_ID_MASK_MISMATCH");
  return document;
}

export function transformCheckoutPiiToDurableTaxDocument(input: {
  checkout: {
    checkoutSessionId: string;
    storeId: string;
    encrypted: EncryptedCheckoutPii;
    expiresAt: Date;
    keys: CheckoutPiiKeyProvider;
    now?: Date;
  };
  orderId: string;
  taxKeys: DurableTaxDocumentKeyProvider;
  random?: (size: number) => Buffer;
}): DurableTaxDocumentBundle {
  const pii = decryptCheckoutPii(input.checkout);
  return encryptDurableTaxDocument({
    document: {
      type: pii.contact.personType === "fisica" ? "cpf" : "cnpj",
      value: pii.contact.taxDocument,
    },
    storeId: input.checkout.storeId,
    orderId: input.orderId,
    keys: input.taxKeys,
    random: input.random,
  });
}

function decodeSecret(value: string | undefined, error: string): Buffer {
  if (!value?.trim()) fail(error);
  const decoded = Buffer.from(value.trim(), "base64url");
  if (decoded.byteLength !== 32) fail(error);
  return decoded;
}

export function environmentDurableTaxDocumentKeys(
  environment: NodeJS.ProcessEnv = process.env,
): DurableTaxDocumentKeyProvider {
  const keyId = environment.ORDER_TAX_DOCUMENT_KEY_ID?.trim();
  if (!keyId || !KEY_ID_PATTERN.test(keyId)) fail("TAX_ID_KEY_ID_INVALID");
  let configured: unknown;
  try { configured = JSON.parse(environment.ORDER_TAX_DOCUMENT_ENCRYPTION_KEYS_JSON ?? ""); }
  catch { fail("TAX_ID_KEYS_INVALID"); }
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) fail("TAX_ID_KEYS_INVALID");
  return {
    currentKeyId: () => keyId,
    encryptionKey: (requested) => {
      const encoded = (configured as Record<string, unknown>)[requested];
      if (typeof encoded !== "string") fail("TAX_ID_KEY_UNKNOWN");
      return decodeSecret(encoded, "TAX_ID_KEY_INVALID");
    },
    fingerprintKey: () => decodeSecret(
      environment.ORDER_TAX_DOCUMENT_HMAC_KEY,
      "TAX_ID_HMAC_KEY_INVALID",
    ),
  };
}
