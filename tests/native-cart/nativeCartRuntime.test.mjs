import assert from "node:assert/strict";
import test from "node:test";
import { canAccessNativeCart, generateGuestCartToken, hashGuestCartToken, verifyGuestCartToken } from "../../lib/db/nativeCart.ts";

test("generated guest tokens are high entropy, unique and never stored raw", () => {
  const first=generateGuestCartToken(),second=generateGuestCartToken();
  assert.notEqual(first,second); assert.ok(first.length>=43);
  assert.match(hashGuestCartToken(first),/^[0-9a-f]{64}$/);
  assert.equal(verifyGuestCartToken(first,hashGuestCartToken(first)),true);
  assert.equal(verifyGuestCartToken(second,hashGuestCartToken(first)),false);
});

test("UUID alone, invalid capability and cross-store access are rejected", () => {
  const token=generateGuestCartToken();
  const base={requestedStoreId:"store-a",cartStoreId:"store-a",cartCustomerId:null,guestTokenFingerprint:hashGuestCartToken(token)};
  assert.equal(canAccessNativeCart({...base,owner:{kind:"guest",token}}),true);
  assert.equal(canAccessNativeCart({...base,owner:{kind:"guest",token:generateGuestCartToken()}}),false);
  assert.equal(canAccessNativeCart({...base,requestedStoreId:"store-b",owner:{kind:"guest",token}}),false);
});

test("customer access requires exact customer and store", () => {
  const base={requestedStoreId:"store-a",cartStoreId:"store-a",cartCustomerId:"customer-a",guestTokenFingerprint:null};
  assert.equal(canAccessNativeCart({...base,owner:{kind:"customer",customerId:"customer-a"}}),true);
  assert.equal(canAccessNativeCart({...base,owner:{kind:"customer",customerId:"customer-b"}}),false);
  assert.equal(canAccessNativeCart({...base,requestedStoreId:"store-b",owner:{kind:"customer",customerId:"customer-a"}}),false);
});
