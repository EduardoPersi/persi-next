import assert from "node:assert/strict";
import test from "node:test";
import { CheckoutPiiValidationError, canonicalizeCheckoutPii, environmentCheckoutPiiKeys } from "../lib/commerce/checkoutPii.ts";

// Direct unit coverage for canonicalizeCheckoutPii -- until now this
// function had NO test calling it directly (only indirectly, through
// handler tests that mock persistNativeCheckoutPii entirely, so the real
// validation logic was never actually exercised by `npm test`). That gap
// is exactly why three separate staging rounds each found a different
// rejected field (personType, missing shipping, then a repeated-digit
// phone number) one at a time instead of all at once locally.

function validAddress(overrides = {}) {
  return { recipient: "Maria Silva", street: "Rua das Flores", number: "100", neighborhood: "Centro", city: "Jundiaí", state: "SP", postalCode: "13201000", country: "BR", ...overrides };
}

function validEnvelope(overrides = {}) {
  return {
    contact: { firstName: "Maria", lastName: "Silva", email: "maria@example.com", phone: "11987654321", personType: "fisica", taxDocument: "11144477735", ...overrides.contact },
    billing: validAddress(overrides.billing),
    shipping: validAddress(overrides.shipping),
    shippingSameAsBilling: true,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !["contact", "billing", "shipping"].includes(key))),
  };
}

// node:assert's assert.throws (unlike Jest's toThrow) returns undefined, not
// the thrown error -- capture it directly instead.
function captureThrow(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

test("canonicalizeCheckoutPii aceita um envelope válido completo", () => {
  const result = canonicalizeCheckoutPii(validEnvelope());
  assert.equal(result.contact.taxDocument, "11144477735");
  assert.equal(result.contact.phone, "+5511987654321");
  assert.equal(result.billing.state, "SP");
  assert.equal(result.billing.postalCode, "13201000");
});

test("canonicalizeCheckoutPii rejeita telefone com assinante repetido (ex.: 11999999999) nomeando contact.phone", () => {
  const error = captureThrow(() => canonicalizeCheckoutPii(validEnvelope({ contact: { phone: "11999999999" } })));
  assert.ok(error instanceof CheckoutPiiValidationError);
  assert.equal(error.field, "contact.phone");
  assert.equal(error.message, "CHECKOUT_PII_INVALID");
});

test("canonicalizeCheckoutPii rejeita CPF com dígito verificador inválido nomeando contact.taxDocument", () => {
  const error = captureThrow(() => canonicalizeCheckoutPii(validEnvelope({ contact: { taxDocument: "11144477700" } })));
  assert.ok(error instanceof CheckoutPiiValidationError);
  assert.equal(error.field, "contact.taxDocument");
});

test("canonicalizeCheckoutPii rejeita personType inconsistente com o documento (CNPJ com personType fisica) nomeando contact.personType", () => {
  const error = captureThrow(() => canonicalizeCheckoutPii(validEnvelope({ contact: { personType: "fisica", taxDocument: "11444777000161" } })));
  assert.ok(error instanceof CheckoutPiiValidationError);
  assert.equal(error.field, "contact.personType");
});

test("canonicalizeCheckoutPii rejeita CEP fora do formato (não 8 dígitos) nomeando billing.postalCode", () => {
  const error = captureThrow(() => canonicalizeCheckoutPii(validEnvelope({ billing: { postalCode: "1320-100" } })));
  assert.ok(error instanceof CheckoutPiiValidationError);
  assert.equal(error.field, "billing.postalCode");
});

test("canonicalizeCheckoutPii rejeita UF que não é um estado brasileiro válido nomeando billing.state", () => {
  const error = captureThrow(() => canonicalizeCheckoutPii(validEnvelope({ billing: { state: "ZZ" } })));
  assert.ok(error instanceof CheckoutPiiValidationError);
  assert.equal(error.field, "billing.state");
});

test("canonicalizeCheckoutPii rejeita quando o campo shipping inteiro está ausente, mesmo com shippingSameAsBilling:true", () => {
  const input = validEnvelope();
  delete input.shipping;
  const error = captureThrow(() => canonicalizeCheckoutPii(input));
  assert.ok(error instanceof CheckoutPiiValidationError);
  assert.equal(error.field, "shipping");
});

test("canonicalizeCheckoutPii rejeita quando personType está ausente", () => {
  const input = validEnvelope();
  delete input.contact.personType;
  const error = captureThrow(() => canonicalizeCheckoutPii(input));
  assert.ok(error instanceof CheckoutPiiValidationError);
  assert.equal(error.field, "contact.personType");
});

test("canonicalizeCheckoutPii: a mensagem de erro nunca contém o valor rejeitado, só o nome do campo", () => {
  const error = captureThrow(() => canonicalizeCheckoutPii(validEnvelope({ contact: { phone: "11999999999" } })));
  assert.ok(error instanceof CheckoutPiiValidationError);
  assert.doesNotMatch(JSON.stringify({ message: error.message, field: error.field }), /11999999999/);
});

// ---------- environmentCheckoutPiiKeys (achado do smoke test de staging, 2026-09-25) ----------

const SAMPLE_KEY_A = Buffer.alloc(32, 0xaa).toString("base64url");
const SAMPLE_KEY_B = Buffer.alloc(32, 0xbb).toString("base64url");
const SAMPLE_HMAC_KEY = Buffer.alloc(32, 0xcc).toString("base64url");

test("environmentCheckoutPiiKeys: formato JSON (CHECKOUT_PII_ENCRYPTION_KEYS_JSON) continua funcionando -- comportamento pré-existente", () => {
  const provider = environmentCheckoutPiiKeys({
    CHECKOUT_PII_KEY_ID: "v1",
    CHECKOUT_PII_ENCRYPTION_KEYS_JSON: JSON.stringify({ v1: SAMPLE_KEY_A }),
    CHECKOUT_PII_HMAC_KEY: SAMPLE_HMAC_KEY,
  });
  assert.equal(provider.currentKeyId(), "v1");
  assert.deepEqual(provider.encryptionKey("v1"), Buffer.from(SAMPLE_KEY_A, "base64url"));
});

test("environmentCheckoutPiiKeys: aceita CHECKOUT_PII_ENCRYPTION_KEY_<KEYID> quando CHECKOUT_PII_ENCRYPTION_KEYS_JSON não está definida", () => {
  const provider = environmentCheckoutPiiKeys({
    CHECKOUT_PII_KEY_ID: "v1",
    CHECKOUT_PII_ENCRYPTION_KEY_V1: SAMPLE_KEY_A,
    CHECKOUT_PII_HMAC_KEY: SAMPLE_HMAC_KEY,
  });
  assert.deepEqual(provider.encryptionKey("v1"), Buffer.from(SAMPLE_KEY_A, "base64url"));
});

test("environmentCheckoutPiiKeys: cai para CHECKOUT_PII_ENCRYPTION_KEY_<KEYID> quando o JSON está malformado (o cenário real: um painel cortou o `{\" inicial)", () => {
  const provider = environmentCheckoutPiiKeys({
    CHECKOUT_PII_KEY_ID: "v1",
    CHECKOUT_PII_ENCRYPTION_KEYS_JSON: `v1":"${SAMPLE_KEY_A}"}`, // `{"` cortado -- JSON.parse falha
    CHECKOUT_PII_ENCRYPTION_KEY_V1: SAMPLE_KEY_A,
    CHECKOUT_PII_HMAC_KEY: SAMPLE_HMAC_KEY,
  });
  assert.deepEqual(provider.encryptionKey("v1"), Buffer.from(SAMPLE_KEY_A, "base64url"));
});

test("environmentCheckoutPiiKeys: keyId com caracteres não alfanuméricos (ex.: \"2026.09\") vira sufixo de variável seguro (pontos/traços -> _)", () => {
  const provider = environmentCheckoutPiiKeys({
    CHECKOUT_PII_KEY_ID: "2026.09-a",
    CHECKOUT_PII_ENCRYPTION_KEY_2026_09_A: SAMPLE_KEY_A,
    CHECKOUT_PII_HMAC_KEY: SAMPLE_HMAC_KEY,
  });
  assert.deepEqual(provider.encryptionKey("2026.09-a"), Buffer.from(SAMPLE_KEY_A, "base64url"));
});

test("environmentCheckoutPiiKeys: nenhum dos dois formatos presente -> CHECKOUT_PII_UNKNOWN_KEY ao tentar usar a chave", () => {
  const provider = environmentCheckoutPiiKeys({
    CHECKOUT_PII_KEY_ID: "v1",
    CHECKOUT_PII_HMAC_KEY: SAMPLE_HMAC_KEY,
  });
  const error = captureThrow(() => provider.encryptionKey("v1"));
  assert.ok(error instanceof Error);
  assert.equal(error.message, "CHECKOUT_PII_UNKNOWN_KEY");
});

test("environmentCheckoutPiiKeys: JSON presente mas sem a keyId pedida cai para a variável por chave (não falha só porque o JSON existe)", () => {
  const provider = environmentCheckoutPiiKeys({
    CHECKOUT_PII_KEY_ID: "v2",
    CHECKOUT_PII_ENCRYPTION_KEYS_JSON: JSON.stringify({ v1: SAMPLE_KEY_A }), // não tem "v2"
    CHECKOUT_PII_ENCRYPTION_KEY_V2: SAMPLE_KEY_B,
    CHECKOUT_PII_HMAC_KEY: SAMPLE_HMAC_KEY,
  });
  assert.deepEqual(provider.encryptionKey("v2"), Buffer.from(SAMPLE_KEY_B, "base64url"));
});
