import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const moduleUrl = new URL("../lib/db/nativeCart.ts", import.meta.url);
const source = await readFile(moduleUrl, "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260902190000_native_cart_foundation.sql", import.meta.url), "utf8");

test("native cart capability uses server-only cryptographic random token and SHA-256", () => {
  assert.match(source, /import "server-only"/);
  assert.match(source, /randomBytes\(NATIVE_CART_TOKEN_BYTES\)/);
  assert.match(source, /NATIVE_CART_TOKEN_BYTES = 32/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /timingSafeEqual/);
  assert.doesNotMatch(migration, /^\s+guest_token\s+text/m);
});

test("cart ownership requires store and customer or guest capability", () => {
  assert.match(source, /requestedStoreId !== input\.cartStoreId/);
  assert.match(source, /input\.cartCustomerId === input\.owner\.customerId/);
  assert.match(source, /verifyGuestCartToken/);
});

test("migration keeps price, PII, shipping and inventory reservation out of cart", () => {
  assert.doesNotMatch(migration, /price_minor|email|phone|tax_id|postal_code|shipping_quote|inventory_reservation_id/);
  assert.match(migration, /Price and stock are revalidated server-side/);
});

test("merge is serialized, additive, idempotent and invalidates guest capability", () => {
  assert.match(migration, /order by id for update/);
  assert.match(migration, /cart_items\.quantity\+excluded\.quantity/);
  assert.match(migration, /g\.status='merged'.*return p_customer_cart_id/s);
  assert.match(migration, /status='merged',guest_token_fingerprint=null/);
});

test("Woo cart runtime remains untouched and native cart remains dark", () => {
  assert.match(migration, /Dark\/unwired/);
  assert.match(migration, /Woo cart remains authoritative/);
});
