import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260903010000_native_order_foundation.sql", "utf8");
const repository = await readFile("lib/db/nativeOrder.ts", "utf8");
const schema = await readFile("lib/db/schema/orders.ts", "utf8");

test("C2 creates only order foundation tables", () => {
  for (const table of ["orders", "order_items", "order_addresses", "order_adjustments", "order_status_events"]) assert.match(migration, new RegExp(`create table public\\.${table}`));
  for (const forbidden of ["payment_attempts", "payment_events", "refunds", "integration_outbox"]) assert.doesNotMatch(migration, new RegExp(`create table public\\.${forbidden}`));
});
test("order states are independent from payment and shipment", () => { assert.match(migration, /order_status as enum \('pending','confirmed','cancelled','completed'\)/); assert.doesNotMatch(migration, /pending_payment|ready_to_ship|shipped|delivered/); });
test("number allocation is atomic and never MAX plus one", () => { assert.match(migration, /update public\.stores s set next_order_sequence/); assert.doesNotMatch(migration, /max\s*\(/i); });
test("checkout relationship is unique and optional", () => { assert.match(migration, /checkout_session_id uuid unique references/); });
test("all authoritative money uses bigint and arithmetic checks", () => { assert.doesNotMatch(migration, /\b(float|real|double precision)\b/i); assert.match(migration, /orders_totals_check/); assert.match(migration, /order_items_subtotal_check/); });
test("snapshots and events are immutable", () => { assert.match(migration, /order_items_immutable/); assert.match(migration, /order_addresses_immutable/); assert.match(migration, /order_status_events_append_only/); });
test("tax document contract forbids plaintext", () => { assert.match(migration, /tax_id_ciphertext/); assert.match(migration, /tax_id_fingerprint/); assert.doesNotMatch(migration, /tax_id_plaintext/); });
test("browser and generic readonly access are absent", () => { assert.match(migration, /revoke all .* from public,anon,authenticated/s); assert.doesNotMatch(migration, /grant .* to (anon|authenticated|persi_readonly)/i); });
test("repository is server-only and set-based", () => { assert.match(repository, /^import "server-only";/); assert.match(repository, /jsonb_agg/); assert.doesNotMatch(repository, /fetch\(|woocommerce|olist|openai/i); });
test("Drizzle exposes bigint order fields", () => { assert.match(schema, /orderSequence: bigint/); assert.match(schema, /grandTotalMinor: bigint/); });
test("runtime remains dark", async () => { const packageJson = await readFile("package.json", "utf8"); assert.doesNotMatch(packageJson, /nativeOrder.*start|enableNativeOrder/i); });
