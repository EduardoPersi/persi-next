import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20260902230000_native_checkout_foundation.sql";
const sourcePath = "lib/db/nativeCheckout.ts";

test("C1 creates only checkout-side domain tables", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const table of ["checkout_sessions", "checkout_session_items", "checkout_shipping_quotes"]) assert.match(sql, new RegExp(`create table public\\.${table}`));
  assert.doesNotMatch(sql, /create table public\.(orders|order_items|payment_attempts|refunds|integration_outbox)/);
});

test("checkout status remains independent from order/payment/shipping", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /'open','validating','ready','submitting','order_created','expired','cancelled'/);
  assert.doesNotMatch(sql, /'paid'|'payment_failed'|'shipped'/);
});

test("money uses bigint and database arithmetic checks", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.doesNotMatch(sql, /\b(float|real|double precision)\b/i);
  assert.match(sql, /line_subtotal_minor = unit_effective_amount_minor \* quantity/);
  assert.match(sql, /line_total_minor = line_subtotal_minor - line_discount_minor \+ line_tax_minor/);
});

test("inventory reuses the existing atomic reservation primitive", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /perform public\.reserve_inventory/);
  assert.match(sql, /perform public\.release_inventory_reservation/);
  assert.doesNotMatch(sql, /perform public\.confirm_inventory_reservation/);
  assert.doesNotMatch(sql, /create table public\.checkout_inventory/);
});

test("runtime remains dark and Woo checkout files are untouched by C1", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /Local\/dark: no runtime wiring and no orders/);
  assert.doesNotMatch(sql, /alter table public\.orders/);
});

test("browser roles have neither tables nor function execution", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /revoke all on public\.checkout_sessions,public\.checkout_session_items,public\.checkout_shipping_quotes from public,anon,authenticated/);
  assert.match(sql, /from public,anon,authenticated/);
  assert.doesNotMatch(sql, /to anon|to authenticated/);
});

test("request hash canonicalization is stable and excludes capability", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /native-checkout-intent-v1/);
  assert.match(source, /Object\.entries\(value\)\.sort/);
  const functionBody = source.slice(source.indexOf("export function createNativeCheckoutRequestHash"), source.indexOf("export function createLogisticsFingerprint"));
  assert.doesNotMatch(functionBody, /guestToken|fingerprintGuestCartToken/);
});

test("read model is set-based and server-only", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.ok(source.startsWith('import "server-only";'));
  assert.match(source, /jsonb_agg\(to_jsonb\(i\)/);
  assert.match(source, /jsonb_agg\(jsonb_build_object/);
});
