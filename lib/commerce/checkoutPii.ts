import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
  type BinaryLike,
} from "node:crypto";
import { z } from "zod";
import { validateBrazilianPhone } from "@/lib/account/phoneValidation";
import { BRAZILIAN_STATES } from "@/lib/constants/brazilianStates";
import { detectBrazilianDocumentType, isValidBrazilianDocument } from "@/lib/validation/document";

export const CHECKOUT_PII_SCHEMA_VERSION = 1;
export const CHECKOUT_PII_PURPOSE = "persi.checkout.pii";
const PII_FINGERPRINT_PURPOSE = "persi.checkout.pii-fingerprint";
const DESTINATION_FINGERPRINT_PURPOSE = "persi.checkout.shipping-destination";

export type CanonicalCheckoutContact = {
  firstName: string;
  lastName: string;
  company: string | null;
  email: string;
  phone: string;
  personType: "fisica" | "juridica";
  taxDocument: string;
};

export type CanonicalCheckoutAddress = {
  recipient: string;
  company: string | null;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  country: "BR";
};

export type CanonicalCheckoutPIIEnvelope = {
  schemaVersion: 1;
  contact: CanonicalCheckoutContact;
  billing: CanonicalCheckoutAddress;
  shipping: CanonicalCheckoutAddress;
  shippingSameAsBilling: boolean;
};

export type CheckoutPiiKeyProvider = {
  currentKeyId(): string;
  encryptionKey(keyId: string): Buffer;
  fingerprintKey(): Buffer;
};

export type EncryptedCheckoutPii = {
  ciphertext: string;
  iv: string;
  authTag: string;
  envelopeVersion: number;
  keyId: string;
  fingerprint: string;
  destinationFingerprint: string;
};

const compactText = (value: string) => value.trim().replace(/\s+/gu, " ");
const optionalText = (value?: string | null) => {
  const normalized = compactText(value ?? "");
  return normalized || null;
};

const inputAddressSchema = z.object({
  recipient: z.string(), company: z.string().nullish(), street: z.string(), number: z.string(),
  complement: z.string().nullish(), neighborhood: z.string(), city: z.string(), state: z.string(),
  postalCode: z.string(), country: z.string(),
}).strict();

const inputEnvelopeSchema = z.object({
  contact: z.object({
    firstName: z.string(), lastName: z.string(), company: z.string().nullish(), email: z.string(),
    phone: z.string(), personType: z.enum(["fisica", "juridica"]), taxDocument: z.string(),
  }).strict(),
  billing: inputAddressSchema,
  shipping: inputAddressSchema,
  shippingSameAsBilling: z.boolean(),
}).strict();

const canonicalAddressSchema = z.object({
  recipient: z.string().min(1).max(200), company: z.string().max(200).nullable(),
  street: z.string().min(1).max(250), number: z.string().min(1).max(50),
  complement: z.string().max(250).nullable(), neighborhood: z.string().min(1).max(150),
  city: z.string().min(1).max(150), state: z.enum(BRAZILIAN_STATES),
  postalCode: z.string().regex(/^\d{8}$/), country: z.literal("BR"),
}).strict();

export const canonicalCheckoutPiiSchema = z.object({
  schemaVersion: z.literal(1),
  contact: z.object({
    firstName: z.string().min(1).max(100), lastName: z.string().min(1).max(100),
    company: z.string().max(200).nullable(), email: z.email().max(254),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/), personType: z.enum(["fisica", "juridica"]),
    taxDocument: z.string().regex(/^\d{11}(?:\d{3})?$/),
  }).strict(),
  billing: canonicalAddressSchema,
  shipping: canonicalAddressSchema,
  shippingSameAsBilling: z.boolean(),
}).strict();

function canonicalAddress(input: z.infer<typeof inputAddressSchema>): CanonicalCheckoutAddress {
  const state = input.state.trim().toUpperCase();
  const country = input.country.trim().toUpperCase();
  const address = {
    recipient: compactText(input.recipient), company: optionalText(input.company),
    street: compactText(input.street), number: compactText(input.number),
    complement: optionalText(input.complement), neighborhood: compactText(input.neighborhood),
    city: compactText(input.city), state, postalCode: input.postalCode.replace(/\D/g, ""), country,
  };
  return canonicalAddressSchema.parse(address) as CanonicalCheckoutAddress;
}

function canonicalPhone(value: string): string {
  const rawDigits = value.replace(/\D/g, "");
  const brazilianDigits = rawDigits.startsWith("55") && rawDigits.length >= 12
    ? rawDigits.slice(2)
    : rawDigits;
  if (validateBrazilianPhone(brazilianDigits)) throw new Error("CHECKOUT_PII_INVALID");
  return `+55${brazilianDigits}`;
}

export function canonicalizeCheckoutPii(input: unknown): CanonicalCheckoutPIIEnvelope {
  const parsed = inputEnvelopeSchema.safeParse(input);
  if (!parsed.success) throw new Error("CHECKOUT_PII_INVALID");
  const taxDocument = parsed.data.contact.taxDocument.replace(/\D/g, "");
  const detected = detectBrazilianDocumentType(taxDocument);
  const expected = parsed.data.contact.personType === "fisica" ? "cpf" : "cnpj";
  if (!isValidBrazilianDocument(taxDocument) || detected !== expected) throw new Error("CHECKOUT_PII_INVALID");
  const billing = canonicalAddress(parsed.data.billing);
  const shipping = parsed.data.shippingSameAsBilling ? { ...billing } : canonicalAddress(parsed.data.shipping);
  const envelope = {
    schemaVersion: CHECKOUT_PII_SCHEMA_VERSION,
    contact: {
      firstName: compactText(parsed.data.contact.firstName),
      lastName: compactText(parsed.data.contact.lastName),
      company: optionalText(parsed.data.contact.company),
      email: parsed.data.contact.email.trim().toLowerCase(),
      phone: canonicalPhone(parsed.data.contact.phone),
      personType: parsed.data.contact.personType,
      taxDocument,
    },
    billing,
    shipping,
    shippingSameAsBilling: parsed.data.shippingSameAsBilling,
  };
  const result = canonicalCheckoutPiiSchema.safeParse(envelope);
  if (!result.success) throw new Error("CHECKOUT_PII_INVALID");
  return result.data;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hmac(key: BinaryLike, purpose: string, value: unknown): string {
  return createHmac("sha256", key).update(purpose, "utf8").update("\0", "utf8")
    .update(canonicalJson(value), "utf8").digest("hex");
}

export function createCheckoutPiiFingerprint(envelope: CanonicalCheckoutPIIEnvelope, key: Buffer): string {
  return hmac(key, PII_FINGERPRINT_PURPOSE, envelope);
}

export function createShippingDestinationFingerprint(address: CanonicalCheckoutAddress, key: Buffer): string {
  return hmac(key, DESTINATION_FINGERPRINT_PURPOSE, address);
}

function aad(input: { checkoutSessionId: string; storeId: string; envelopeVersion: number; keyId: string }) {
  return Buffer.from(canonicalJson({ purpose: CHECKOUT_PII_PURPOSE, ...input }), "utf8");
}

export function encryptCheckoutPii(input: {
  checkoutSessionId: string;
  storeId: string;
  envelope: CanonicalCheckoutPIIEnvelope;
  keys: CheckoutPiiKeyProvider;
  random?: (size: number) => Buffer;
}): EncryptedCheckoutPii {
  const keyId = input.keys.currentKeyId();
  const key = input.keys.encryptionKey(keyId);
  if (key.byteLength !== 32) throw new Error("CHECKOUT_PII_KEY_INVALID");
  const fingerprintKey = input.keys.fingerprintKey();
  if (fingerprintKey.byteLength < 32) throw new Error("CHECKOUT_PII_HMAC_KEY_INVALID");
  const iv = (input.random ?? randomBytes)(12);
  if (iv.byteLength !== 12) throw new Error("CHECKOUT_PII_IV_INVALID");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad({ checkoutSessionId: input.checkoutSessionId, storeId: input.storeId, envelopeVersion: input.envelope.schemaVersion, keyId }));
  const ciphertext = Buffer.concat([cipher.update(canonicalJson(input.envelope), "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"), iv: iv.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"), envelopeVersion: input.envelope.schemaVersion,
    keyId, fingerprint: createCheckoutPiiFingerprint(input.envelope, fingerprintKey),
    destinationFingerprint: createShippingDestinationFingerprint(input.envelope.shipping, fingerprintKey),
  };
}

export function decryptCheckoutPii(input: {
  checkoutSessionId: string;
  storeId: string;
  encrypted: EncryptedCheckoutPii;
  expiresAt: Date;
  keys: CheckoutPiiKeyProvider;
  now?: Date;
}): CanonicalCheckoutPIIEnvelope {
  if (input.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) throw new Error("CHECKOUT_PII_EXPIRED");
  let plaintext: Buffer;
  try {
    const key = input.keys.encryptionKey(input.encrypted.keyId);
    if (key.byteLength !== 32) throw new Error("CHECKOUT_PII_KEY_INVALID");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(input.encrypted.iv, "base64url"));
    decipher.setAAD(aad({ checkoutSessionId: input.checkoutSessionId, storeId: input.storeId, envelopeVersion: input.encrypted.envelopeVersion, keyId: input.encrypted.keyId }));
    decipher.setAuthTag(Buffer.from(input.encrypted.authTag, "base64url"));
    plaintext = Buffer.concat([decipher.update(Buffer.from(input.encrypted.ciphertext, "base64url")), decipher.final()]);
  } catch (error) {
    if (error instanceof Error && error.message === "CHECKOUT_PII_UNKNOWN_KEY") throw error;
    throw new Error("CHECKOUT_PII_TAMPERED");
  }
  let decoded: unknown;
  try { decoded = JSON.parse(plaintext.toString("utf8")); } catch { throw new Error("CHECKOUT_PII_TAMPERED"); }
  const parsed = canonicalCheckoutPiiSchema.safeParse(decoded);
  if (!parsed.success) throw new Error("CHECKOUT_PII_TAMPERED");
  const recomputed = createCheckoutPiiFingerprint(parsed.data, input.keys.fingerprintKey());
  const expected = Buffer.from(input.encrypted.fingerprint, "hex");
  const actual = Buffer.from(recomputed, "hex");
  if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) throw new Error("CHECKOUT_PII_TAMPERED");
  const recomputedDestination = createShippingDestinationFingerprint(parsed.data.shipping, input.keys.fingerprintKey());
  const expectedDestination = Buffer.from(input.encrypted.destinationFingerprint, "hex");
  const actualDestination = Buffer.from(recomputedDestination, "hex");
  if (expectedDestination.byteLength !== actualDestination.byteLength ||
      !timingSafeEqual(expectedDestination, actualDestination)) throw new Error("CHECKOUT_PII_TAMPERED");
  return parsed.data;
}

function decodeSecret(value: string | undefined, error: string): Buffer {
  if (!value?.trim()) throw new Error(error);
  const decoded = Buffer.from(value.trim(), "base64url");
  if (decoded.byteLength !== 32) throw new Error(error);
  return decoded;
}

export function environmentCheckoutPiiKeys(environment: NodeJS.ProcessEnv = process.env): CheckoutPiiKeyProvider {
  const keyId = environment.CHECKOUT_PII_KEY_ID?.trim();
  if (!keyId || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(keyId)) throw new Error("CHECKOUT_PII_KEY_ID_INVALID");
  let configured: unknown;
  try { configured = JSON.parse(environment.CHECKOUT_PII_ENCRYPTION_KEYS_JSON ?? ""); } catch { throw new Error("CHECKOUT_PII_KEYS_INVALID"); }
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) throw new Error("CHECKOUT_PII_KEYS_INVALID");
  return {
    currentKeyId: () => keyId,
    encryptionKey: (requested) => {
      const encoded = (configured as Record<string, unknown>)[requested];
      if (typeof encoded !== "string") throw new Error("CHECKOUT_PII_UNKNOWN_KEY");
      return decodeSecret(encoded, "CHECKOUT_PII_KEY_INVALID");
    },
    fingerprintKey: () => decodeSecret(environment.CHECKOUT_PII_HMAC_KEY, "CHECKOUT_PII_HMAC_KEY_INVALID"),
  };
}
