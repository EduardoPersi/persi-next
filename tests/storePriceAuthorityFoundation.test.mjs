import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260903120000_store_price_authority_foundation.sql", "utf8");
const repository = await readFile("lib/db/nativePriceAuthority.ts", "utf8");
const schema = await readFile("lib/db/schema/priceAuthority.ts", "utf8");
const checkout = await readFile("lib/db/schema/checkout.ts", "utf8");

test("P1 creates one authority table and no business data", () => {
  assert.match(migration, /create table public\.store_price_list_assignments/);
  assert.doesNotMatch(migration, /insert into/i);
});
test("authority scope is explicit and versioned with bigint", () => {
  for (const field of ["store_id", "price_list_id", "currency", "commercial_context", "version", "valid_from", "valid_to"]) assert.match(migration, new RegExp(field));
  assert.match(migration, /version bigint not null check\(version>0\)/);
});
test("overlap and monotonic versions serialize without MAX plus one", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /STORE_PRICE_CONFIG_OVERLAP/);
  assert.doesNotMatch(migration, /max\([^)]*\)\s*\+\s*1/i);
});
test("currency is enforced by composite foreign keys", () => {
  assert.match(migration, /store_id uuid not null references public\.stores/);
  assert.match(migration, /foreign key\(price_list_id,currency\)/);
});
test("resolver is fail-closed and checks list status and channel", () => {
  for (const code of ["STORE_PRICE_CONFIG_MISSING", "STORE_PRICE_CONFIG_AMBIGUOUS", "PRICE_LIST_INACTIVE", "PRICE_CURRENCY_MISMATCH", "PRICE_LIST_CHANNEL_MISMATCH"]) assert.match(migration, new RegExp(code));
});
test("checkout snapshots authority and requires it before ready", () => {
  for (const field of ["store_price_list_assignment_id", "store_price_list_assignment_version", "price_list_id"]) assert.match(migration, new RegExp(field));
  assert.match(migration, /CHECKOUT_PRICE_AUTHORITY_REQUIRED/);
  assert.match(migration, /CHECKOUT_PRICE_AUTHORITY_IMMUTABLE/);
});
test("configuration has RLS and no browser or configuration DML grants", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all .*persi_app,persi_worker,persi_readonly/s);
  assert.doesNotMatch(migration, /grant (insert|update|delete)/i);
});
test("repository is server-only and contains no external fallback", () => {
  assert.match(repository, /^import "server-only";/);
  assert.match(repository, /resolve_store_price_authority/);
  assert.doesNotMatch(repository, /fetch\(|woocommerce|olist|openai/i);
});
test("fingerprint includes full authority and price evidence without guest capability", () => {
  for (const field of ["storeId", "commercialContext", "assignmentId", "assignmentVersion", "priceListId", "currency", "asOf", "priceId", "priceValidFrom", "priceValidTo", "regularAmountMinor", "effectiveAmountMinor"]) assert.match(repository, new RegExp(field));
  assert.doesNotMatch(repository, /guest(Token|Capability)/i);
});
test("Drizzle exposes assignment and checkout bigint snapshot", () => {
  assert.match(schema, /storePriceListAssignments/);
  assert.match(schema, /version: bigint/);
  assert.match(checkout, /storePriceListAssignmentVersion: bigint/);
});
test("native runtime remains dark", async () => {
  const packageJson = await readFile("package.json", "utf8");
  assert.doesNotMatch(packageJson, /enableNativePriceAuthority|nativePriceAuthority.*start/i);
});
