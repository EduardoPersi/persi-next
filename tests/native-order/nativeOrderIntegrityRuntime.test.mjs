import assert from "node:assert/strict";
import test from "node:test";
import { createNativeOrderRequestHash, mapReservationLinkError, NATIVE_ORDER_REQUEST_HASH_VERSION } from "../../lib/db/nativeOrder.ts";

const identity={storeId:"store",checkoutSessionId:"checkout",cartId:"cart",checkoutVersion:4n,cartVersion:3n,storePriceListAssignmentId:"assignment",storePriceListAssignmentVersion:2n,priceListId:"prices",piiFingerprint:"a".repeat(64),destinationFingerprint:"b".repeat(64),checkoutItemsFingerprint:"c".repeat(64),shippingQuoteId:"quote",shippingQuoteKey:"quote-key",logisticsFingerprint:"d".repeat(64),logisticsVersion:"v1",currency:"BRL"};

test("C3 request identity is deterministic and versioned",()=>{
  assert.equal(NATIVE_ORDER_REQUEST_HASH_VERSION,"c3-request-v1");
  assert.equal(createNativeOrderRequestHash(identity),createNativeOrderRequestHash({...identity}));
  assert.match(createNativeOrderRequestHash(identity),/^[0-9a-f]{64}$/);
});

for(const [field,value] of [["piiFingerprint","e".repeat(64)],["destinationFingerprint","e".repeat(64)],["storePriceListAssignmentVersion",3n],["shippingQuoteId","other"],["checkoutItemsFingerprint","e".repeat(64)]]){
  test(`C3 request identity changes with ${field}`,()=>assert.notEqual(createNativeOrderRequestHash(identity),createNativeOrderRequestHash({...identity,[field]:value})));
}

test("guest capability and raw PII cannot enter the closed request contract",()=>{
  const withUnknown={...identity,guestToken:"secret",email:"person@example.invalid",street:"Secret Street"};
  assert.equal(createNativeOrderRequestHash(withUnknown),createNativeOrderRequestHash(identity));
});

test("reservation link errors expose only allowlisted codes",()=>{
  assert.equal(mapReservationLinkError(new Error("db: RESERVATION_EXPIRED")).message,"RESERVATION_EXPIRED");
  assert.equal(mapReservationLinkError(new Error("raw SQL with person@example.invalid")).message,"RESERVATION_LINK_FAILED");
});
