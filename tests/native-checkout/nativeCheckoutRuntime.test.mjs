import assert from "node:assert/strict";
import test from "node:test";
import { createLogisticsFingerprint, createNativeCheckoutRequestHash } from "../../lib/db/nativeCheckout.ts";

const intent = {
  storeId: "store-a", cartId: "cart-a", customerId: null, cartVersion: 7n,
  priceListId: "prices-a", inventoryLocationId: "location-a", currency: "BRL", shippingRequired: true,
};

test("request fingerprint is deterministic and sensitive to immutable intent", () => {
  const first=createNativeCheckoutRequestHash(intent),second=createNativeCheckoutRequestHash({...intent});
  assert.equal(first,second); assert.match(first,/^[0-9a-f]{64}$/);
  assert.notEqual(first,createNativeCheckoutRequestHash({...intent,cartVersion:8n}));
  assert.notEqual(first,createNativeCheckoutRequestHash({...intent,storeId:"store-b"}));
});

test("request fingerprint cannot receive or serialize guest capability", () => {
  const withExtra={...intent,guestToken:"never-hash-this-secret"};
  assert.equal(createNativeCheckoutRequestHash(withExtra),createNativeCheckoutRequestHash(intent));
});

test("logistics fingerprint sorts lines and captures routing changes", () => {
  const input={cartVersion:7n,destinationPostcode:"13201000",inventoryLocationId:"location-a",serviceCode:"service-a",logisticsVersion:"v1",lines:[{variantId:"b",quantity:2n},{variantId:"a",quantity:1n}]};
  const first=createLogisticsFingerprint(input);
  assert.equal(first,createLogisticsFingerprint({...input,lines:[...input.lines].reverse()}));
  assert.notEqual(first,createLogisticsFingerprint({...input,destinationPostcode:"13202000"}));
  assert.notEqual(first,createLogisticsFingerprint({...input,logisticsVersion:"v2"}));
});
