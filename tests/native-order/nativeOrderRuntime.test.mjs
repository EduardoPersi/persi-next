import test from "node:test";
import assert from "node:assert/strict";
import { normalizeNativeOrderAddress, assertEncryptedTaxIdBundle } from "../../lib/db/nativeOrder.ts";
import { encryptDurableTaxDocument } from "../../lib/commerce/taxDocumentCrypto.ts";

test("address normalization preserves text and normalizes routing fields", () => {
  assert.deepEqual(normalizeNativeOrderAddress({ recipient:" Maria ",street:" Rua A ",number:" 10 ",complement:" ",neighborhood:" Centro ",city:" Jundiaí ",state:"sp",postalCode:"13201-000" }), { recipient:"Maria",company:null,street:"Rua A",number:"10",complement:null,neighborhood:"Centro",city:"Jundiaí",state:"SP",postalCode:"13201000",country:"BR" });
});
test("tax ID is optional", () => assert.equal(assertEncryptedTaxIdBundle({}), null));
test("tax ID requires an encrypted complete bundle", () => assert.throws(() => assertEncryptedTaxIdBundle({ type:"cpf", ciphertext:"cipher" }), /NATIVE_ORDER_TAX_ID_ENVELOPE_INVALID/));
test("complete encrypted tax bundle is accepted without plaintext", () => {
  const key = Buffer.alloc(32, 1);
  const value = encryptDurableTaxDocument({
    document: { type: "cpf", value: "52998224725" },
    storeId: "51000000-0000-4000-8000-000000000001",
    orderId: "52000000-0000-4000-8000-000000000001",
    keys: { currentKeyId: () => "tax-v1", encryptionKey: () => key, fingerprintKey: () => Buffer.alloc(32, 2) },
  });
  assert.equal(assertEncryptedTaxIdBundle(value), value);
});
