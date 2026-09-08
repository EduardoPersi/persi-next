import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeCheckoutPii } from "../lib/commerce/checkoutPii.ts";

const raw = () => ({
  contact: { firstName: "Pessoa", lastName: "Sintetica", company: "", email: "fixture@example.invalid", phone: "11912345678", personType: "fisica", taxDocument: "529.982.247-25" },
  billing: { recipient: "Pessoa Sintetica", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" },
  shipping: { recipient: "Pessoa Sintetica", company: "", street: "Rua Teste", number: "10", complement: "", neighborhood: "Centro", city: "Jundiai", state: "SP", postalCode: "13201000", country: "BR" },
  shippingSameAsBilling: true,
});

test("H1 fixture canonicalizes raw PII exactly once", () => {
  const canonical = canonicalizeCheckoutPii(raw());
  assert.equal(canonical.schemaVersion, 1);
  assert.throws(() => canonicalizeCheckoutPii(canonical), /CHECKOUT_PII_INVALID/);
  assert.equal("schemaVersion" in raw(), false);
});
