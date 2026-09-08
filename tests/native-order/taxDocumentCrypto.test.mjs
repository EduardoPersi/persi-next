import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DURABLE_TAX_DOCUMENT_PURPOSE,
  assertDurableTaxDocumentBundle,
  canonicalizeTaxDocument,
  decryptDurableTaxDocument,
  encryptDurableTaxDocument,
  environmentDurableTaxDocumentKeys,
  maskTaxDocument,
  parseDurableTaxDocumentEnvelope,
  transformCheckoutPiiToDurableTaxDocument,
} from "../../lib/commerce/taxDocumentCrypto.ts";
import {
  canonicalizeCheckoutPii,
  encryptCheckoutPii,
} from "../../lib/commerce/checkoutPii.ts";

const storeA = "51000000-0000-4000-8000-000000000001";
const storeB = "51000000-0000-4000-8000-000000000002";
const orderA = "52000000-0000-4000-8000-000000000001";
const orderB = "52000000-0000-4000-8000-000000000002";
const checkoutId = "53000000-0000-4000-8000-000000000001";
const keyV1 = Buffer.alloc(32, 11);
const keyV2 = Buffer.alloc(32, 22);
const hmacKey = Buffer.alloc(32, 33);

function keys(active = "tax-v1", includeV1 = true) {
  const values = new Map([["tax-v2", keyV2]]);
  if (includeV1) values.set("tax-v1", keyV1);
  return {
    currentKeyId: () => active,
    encryptionKey: (keyId) => {
      const value = values.get(keyId);
      if (!value) throw new Error("unknown");
      return value;
    },
    fingerprintKey: () => hmacKey,
  };
}

const cpf = { type: "cpf", value: "529.982.247-25" };
const cnpj = { type: "cnpj", value: "11.222.333/0001-81" };

function encrypted(document = cpf, overrides = {}) {
  return encryptDurableTaxDocument({ document, storeId: storeA, orderId: orderA, keys: keys(), ...overrides });
}

function mutateEnvelope(bundle, change) {
  const envelope = JSON.parse(bundle.ciphertext);
  change(envelope);
  return { ...bundle, ciphertext: JSON.stringify(envelope) };
}

test("canonicalizes formatted CPF and CNPJ using existing validators", () => {
  assert.deepEqual(canonicalizeTaxDocument(cpf), { type: "cpf", value: "52998224725" });
  assert.deepEqual(canonicalizeTaxDocument(cnpj), { type: "cnpj", value: "11222333000181" });
  assert.deepEqual(canonicalizeTaxDocument(cpf), canonicalizeTaxDocument({ type: "cpf", value: "52998224725" }));
});

test("rejects invalid checksum, wrong length and type mismatch with safe codes", () => {
  assert.throws(() => canonicalizeTaxDocument({ type: "cpf", value: "52998224726" }), /TAX_ID_INVALID/);
  assert.throws(() => canonicalizeTaxDocument({ type: "cpf", value: "123" }), /TAX_ID_TYPE_MISMATCH/);
  assert.throws(() => canonicalizeTaxDocument({ type: "cnpj", value: cpf.value }), /TAX_ID_TYPE_MISMATCH/);
  assert.throws(() => canonicalizeTaxDocument({ type: "cpf", value: "529abc98224725" }), /TAX_ID_INVALID/);
});

test("derives privacy-preserving masks server-side", () => {
  assert.equal(maskTaxDocument(canonicalizeTaxDocument(cpf)), "***.***.***-25");
  assert.equal(maskTaxDocument(canonicalizeTaxDocument(cnpj)), "**.***.***/****-81");
});

test("AES-256-GCM roundtrips CPF and CNPJ in order/store context", () => {
  for (const document of [cpf, cnpj]) {
    const bundle = encrypted(document);
    assert.deepEqual(decryptDurableTaxDocument({ bundle, storeId: storeA, orderId: orderA, keys: keys() }), canonicalizeTaxDocument(document));
    assert.doesNotMatch(bundle.ciphertext, new RegExp(canonicalizeTaxDocument(document).value));
  }
});

test("strict envelope is versioned and rejects missing or extra fields", () => {
  const bundle = encrypted();
  assert.equal(parseDurableTaxDocumentEnvelope(bundle.ciphertext).v, 1);
  assert.throws(() => parseDurableTaxDocumentEnvelope(JSON.stringify({ ...JSON.parse(bundle.ciphertext), extra: true })), /TAX_ID_ENVELOPE_INVALID/);
  const missing = JSON.parse(bundle.ciphertext); delete missing.tag;
  assert.throws(() => parseDurableTaxDocumentEnvelope(JSON.stringify(missing)), /TAX_ID_ENVELOPE_INVALID/);
});

test("same document uses fresh IV/ciphertext but deterministic store-scoped fingerprint", () => {
  const first = encrypted();
  const second = encrypted();
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.notEqual(parseDurableTaxDocumentEnvelope(first.ciphertext).iv, parseDurableTaxDocumentEnvelope(second.ciphertext).iv);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.masked, second.masked);
  const otherStore = encryptDurableTaxDocument({ document: cpf, storeId: storeB, orderId: orderA, keys: keys() });
  assert.notEqual(first.fingerprint, otherStore.fingerprint);
});

test("AAD rejects cross-order, cross-store and type substitution", () => {
  const bundle = encrypted();
  assert.throws(() => decryptDurableTaxDocument({ bundle, storeId: storeA, orderId: orderB, keys: keys() }), /TAX_ID_AUTH_FAILED/);
  assert.throws(() => decryptDurableTaxDocument({ bundle, storeId: storeB, orderId: orderA, keys: keys() }), /TAX_ID_AUTH_FAILED/);
  assert.throws(() => decryptDurableTaxDocument({ bundle: { ...bundle, type: "cnpj" }, storeId: storeA, orderId: orderA, keys: keys() }), /TAX_ID_AUTH_FAILED|TAX_ID_ENVELOPE_INVALID/);
});

test("rotation retains historical decrypt and removed key fails closed", () => {
  const oldBundle = encrypted(cpf, { keys: keys("tax-v1") });
  const newBundle = encrypted(cpf, { keys: keys("tax-v2") });
  assert.equal(parseDurableTaxDocumentEnvelope(oldBundle.ciphertext).kid, "tax-v1");
  assert.equal(parseDurableTaxDocumentEnvelope(newBundle.ciphertext).kid, "tax-v2");
  assert.equal(decryptDurableTaxDocument({ bundle: oldBundle, storeId: storeA, orderId: orderA, keys: keys("tax-v2") }).value, "52998224725");
  assert.throws(() => decryptDurableTaxDocument({ bundle: oldBundle, storeId: storeA, orderId: orderA, keys: keys("tax-v2", false) }), /TAX_ID_KEY_UNKNOWN/);
});

test("tampering version, key ID, IV, tag and ciphertext fails closed", () => {
  const bundle = encrypted();
  assert.throws(() => decryptDurableTaxDocument({ bundle: mutateEnvelope(bundle, (value) => { value.v = 2; }), storeId: storeA, orderId: orderA, keys: keys() }), /TAX_ID_VERSION_UNSUPPORTED/);
  assert.throws(() => decryptDurableTaxDocument({ bundle: mutateEnvelope(bundle, (value) => { value.kid = "missing"; }), storeId: storeA, orderId: orderA, keys: keys() }), /TAX_ID_KEY_UNKNOWN/);
  for (const field of ["iv", "tag", "ct"]) {
    const changed = mutateEnvelope(bundle, (value) => {
      const bytes = Buffer.from(value[field], "base64url");
      bytes[0] ^= 1;
      value[field] = bytes.toString("base64url");
    });
    assert.throws(() => decryptDurableTaxDocument({ bundle: changed, storeId: storeA, orderId: orderA, keys: keys() }), /TAX_ID_AUTH_FAILED|TAX_ID_ENVELOPE_INVALID/);
  }
});

test("tampering fingerprint and mask fails with deterministic errors", () => {
  const bundle = encrypted();
  assert.throws(() => decryptDurableTaxDocument({ bundle: { ...bundle, fingerprint: "0".repeat(64) }, storeId: storeA, orderId: orderA, keys: keys() }), /TAX_ID_FINGERPRINT_MISMATCH/);
  assert.throws(() => decryptDurableTaxDocument({ bundle: { ...bundle, masked: "***.***.***-99" }, storeId: storeA, orderId: orderA, keys: keys() }), /TAX_ID_MASK_MISMATCH/);
});

test("bundle assertion rejects arbitrary ciphertext and malformed masks", () => {
  assert.equal(assertDurableTaxDocumentBundle({}), null);
  assert.throws(() => assertDurableTaxDocumentBundle({ type: "cpf", ciphertext: "cipher", fingerprint: "a".repeat(64), masked: "***.***.***-25" }), /TAX_ID_ENVELOPE_INVALID/);
  const bundle = encrypted();
  assert.deepEqual(assertDurableTaxDocumentBundle(bundle), bundle);
  assert.throws(() => assertDurableTaxDocumentBundle({ ...bundle, masked: "529.982.247-25" }), /TAX_ID_ENVELOPE_INVALID/);
});

test("environment provider supports independent tax key namespace without exposing secrets", () => {
  const provider = environmentDurableTaxDocumentKeys({
    ORDER_TAX_DOCUMENT_KEY_ID: "tax-v1",
    ORDER_TAX_DOCUMENT_ENCRYPTION_KEYS_JSON: JSON.stringify({ "tax-v1": keyV1.toString("base64url") }),
    ORDER_TAX_DOCUMENT_HMAC_KEY: hmacKey.toString("base64url"),
  });
  assert.equal(provider.currentKeyId(), "tax-v1");
  assert.deepEqual(provider.encryptionKey("tax-v1"), keyV1);
  assert.throws(() => provider.encryptionKey("missing"), /TAX_ID_KEY_UNKNOWN/);
});

test("temporary checkout PII is decrypted then independently re-encrypted", () => {
  const checkoutKey = Buffer.alloc(32, 44);
  const checkoutHmac = Buffer.alloc(32, 55);
  const checkoutKeys = {
    currentKeyId: () => "checkout-v1",
    encryptionKey: () => checkoutKey,
    fingerprintKey: () => checkoutHmac,
  };
  const pii = canonicalizeCheckoutPii({
    contact: { firstName: "Pessoa", lastName: "Sintética", company: "", email: "fixture@example.invalid", phone: "11912345678", personType: "fisica", taxDocument: cpf.value },
    billing: { recipient: "Pessoa Sintética", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiaí", state: "SP", postalCode: "13201000", country: "BR" },
    shipping: { recipient: "Pessoa Sintética", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiaí", state: "SP", postalCode: "13201000", country: "BR" },
    shippingSameAsBilling: true,
  });
  const temporary = encryptCheckoutPii({ checkoutSessionId: checkoutId, storeId: storeA, envelope: pii, keys: checkoutKeys, random: () => Buffer.alloc(12, 66) });
  const durable = transformCheckoutPiiToDurableTaxDocument({
    checkout: { checkoutSessionId: checkoutId, storeId: storeA, encrypted: temporary, expiresAt: new Date("2030-01-02T00:00:00Z"), now: new Date("2030-01-01T00:00:00Z"), keys: checkoutKeys },
    orderId: orderA,
    taxKeys: keys(),
    random: () => Buffer.alloc(12, 77),
  });
  assert.equal(decryptDurableTaxDocument({ bundle: durable, storeId: storeA, orderId: orderA, keys: keys() }).value, "52998224725");
  assert.notEqual(temporary.ciphertext, durable.ciphertext);
  assert.equal(DURABLE_TAX_DOCUMENT_PURPOSE, "persi.order.tax-document");
  assert.notEqual(DURABLE_TAX_DOCUMENT_PURPOSE, "persi.checkout.pii");
  assert.notEqual(temporary.iv, parseDurableTaxDocumentEnvelope(durable.ciphertext).iv);
});

test("native order public projection does not select durable tax internals", async () => {
  const source = await readFile(new URL("../../lib/db/nativeOrder.ts", import.meta.url), "utf8");
  const readProjection = source.slice(source.indexOf("export async function readNativeOrder"));
  assert.doesNotMatch(readProjection, /tax_id_ciphertext|tax_id_fingerprint|taxIdCiphertext|taxIdFingerprint/);
});
