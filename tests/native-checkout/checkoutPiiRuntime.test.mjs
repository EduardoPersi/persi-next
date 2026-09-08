import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeCheckoutPii, decryptCheckoutPii, encryptCheckoutPii,
  createCheckoutPiiFingerprint, createShippingDestinationFingerprint,
} from "../../lib/commerce/checkoutPii.ts";
import { sanitizeProviderError } from "../../lib/observability/providerError.ts";

const input = {
  contact: { firstName: " Ana  Maria ", lastName: " da Silva ", company: "", email: " ANA@EXAMPLE.COM ", phone: "(11) 91234-5678", personType: "fisica", taxDocument: "529.982.247-25" },
  billing: { recipient: "Ana Maria", company: null, street: "Rua São João", number: "12-A", complement: " Apto  3 ", neighborhood: "Vila Açúcar", city: "Jundiaí", state: "sp", postalCode: "13201-000", country: "br" },
  shipping: { recipient: "Ana Maria", company: null, street: "Rua São João", number: "12-A", complement: " Apto  3 ", neighborhood: "Vila Açúcar", city: "Jundiaí", state: "sp", postalCode: "13201-000", country: "br" },
  shippingSameAsBilling: true,
};
const key = Buffer.alloc(32, 7), hmacKey = Buffer.alloc(32, 9);
const keys = { currentKeyId: () => "test-v1", encryptionKey: (id) => { if (id !== "test-v1") throw new Error("CHECKOUT_PII_UNKNOWN_KEY"); return key; }, fingerprintKey: () => hmacKey };
const context = { checkoutSessionId: "31000000-0000-4000-8000-000000000001", storeId: "32000000-0000-4000-8000-000000000001" };

test("canonicalization preserves structural address and accents", () => {
  const result = canonicalizeCheckoutPii(input);
  assert.equal(result.contact.email, "ana@example.com"); assert.equal(result.contact.phone, "+5511912345678");
  assert.equal(result.contact.taxDocument, "52998224725"); assert.equal(result.billing.street, "Rua São João");
  assert.equal(result.billing.number, "12-A"); assert.equal(result.billing.complement, "Apto 3"); assert.equal(result.billing.neighborhood, "Vila Açúcar");
  assert.deepEqual(result.shipping, result.billing);
});

test("AES-256-GCM round trip uses random 96-bit IV and bound AAD", () => {
  const envelope = canonicalizeCheckoutPii(input), first = encryptCheckoutPii({ ...context, envelope, keys }), second = encryptCheckoutPii({ ...context, envelope, keys });
  assert.notEqual(first.iv, second.iv); assert.equal(Buffer.from(first.iv, "base64url").length, 12); assert.equal(Buffer.from(first.authTag, "base64url").length, 16);
  assert.deepEqual(decryptCheckoutPii({ ...context, encrypted: first, expiresAt: new Date(Date.now()+60_000), keys }), envelope);
  assert.throws(() => decryptCheckoutPii({ ...context, storeId: "wrong", encrypted: first, expiresAt: new Date(Date.now()+60_000), keys }), /CHECKOUT_PII_TAMPERED/);
});

test("fingerprints are deterministic, separately domain-bound, and destination-sensitive", () => {
  const envelope = canonicalizeCheckoutPii(input);
  assert.equal(createCheckoutPiiFingerprint(envelope,hmacKey),createCheckoutPiiFingerprint(envelope,hmacKey));
  assert.notEqual(createCheckoutPiiFingerprint(envelope,hmacKey),createShippingDestinationFingerprint(envelope.shipping,hmacKey));
  assert.notEqual(createShippingDestinationFingerprint(envelope.shipping,hmacKey),createShippingDestinationFingerprint({...envelope.shipping,number:"13"},hmacKey));
});

test("ciphertext, IV, tag, fingerprints, expiry and unknown key fail closed", () => {
  const envelope=canonicalizeCheckoutPii(input), encrypted=encryptCheckoutPii({...context,envelope,keys}), future=new Date(Date.now()+60_000);
  for (const field of ["ciphertext","iv","authTag","fingerprint","destinationFingerprint"]) {
    const changed={...encrypted,[field]:`${encrypted[field][0] === "A" ? "B" : "A"}${encrypted[field].slice(1)}`};
    assert.throws(()=>decryptCheckoutPii({...context,encrypted:changed,expiresAt:future,keys}),/CHECKOUT_PII_TAMPERED/);
  }
  assert.throws(()=>decryptCheckoutPii({...context,encrypted,expiresAt:new Date(0),keys}),/CHECKOUT_PII_EXPIRED/);
  assert.throws(()=>decryptCheckoutPii({...context,encrypted:{...encrypted,keyId:"gone"},expiresAt:future,keys}),/CHECKOUT_PII_UNKNOWN_KEY/);
});

test("provider sanitizer is fail-closed and cannot serialize synthetic PII", () => {
  const secret="529.982.247-25";
  const result=sanitizeProviderError({provider:"pagbank",operation:"POST:/orders",status:400,payload:{message:`CPF ${secret}`,email:"ana@example.com",code:"INVALID_REQUEST",cause:[{street:"Rua São João"}]}});
  const serialized=JSON.stringify(result);
  assert.equal(result.code,"INVALID_REQUEST"); assert.doesNotMatch(serialized,/529|ana@example|São João|message|cause/);
});
