import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const migrationNames = [
  "20260823110000_core.sql",
  "20260823110100_catalog.sql",
  "20260823110200_pim.sql",
  "20260823110300_pricing.sql",
  "20260823110400_inventory.sql",
  "20260823110500_external_mappings.sql",
  "20260823110600_sale_periods.sql",
  "20260824120000_incremental_sync.sql",
  "20260824120100_catalog_search_documents.sql",
  "20260824120200_catalog_search_fuzzy_threshold.sql",
  "20260824120300_search_document_default_variant.sql",
  "20260824130000_catalog_commercial_semantics.sql",
];

async function migration(name) {
  return readFile(path.join(root, "supabase", "migrations", name), "utf8");
}

test("Supabase migrations are ordered and contain only the Phase C domains", async () => {
  assert.deepEqual([...migrationNames].sort(), migrationNames);
  const sql = (await Promise.all(migrationNames.map(migration))).join("\n");
  for (const table of [
    "brands", "categories", "products", "product_variants", "media_assets", "product_media",
    "units", "attributes", "attribute_values", "measurement_components", "price_lists", "prices",
    "price_history", "inventory_locations", "inventory_levels", "inventory_movements",
    "inventory_reservations", "external_mappings",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table} \\(`));
  }
  for (const forbidden of ["customers", "carts", "orders", "payments", "webhook_events", "outbox_events"]) {
    assert.doesNotMatch(sql, new RegExp(`create table public\\.${forbidden} \\(`));
  }
});
test("catalog identity, money and external mappings have required uniqueness", async () => {
  const catalog = await migration("20260823110100_catalog.sql");
  const pricing = await migration("20260823110300_pricing.sql");
  const mappings = await migration("20260823110500_external_mappings.sql");
  assert.match(catalog, /product_variants_sku_unique/);
  assert.match(catalog, /product_variants_gtin_unique[\s\S]*where gtin is not null/);
  assert.match(pricing, /list_amount_minor bigint not null check \(list_amount_minor >= 0\)/);
  assert.match(mappings, /unique \(system, entity_type, external_id\)/);
});

test("PIM keeps composite display and exact rational components", async () => {
  const pim = await migration("20260823110200_pim.sql");
  const databaseTests = await readFile(
    path.join(root, "supabase", "tests", "database", "core_catalog_pim_pricing_inventory.test.sql"),
    "utf8",
  );
  assert.match(pim, /display_value text not null/);
  assert.match(pim, /numerator bigint not null/);
  assert.match(pim, /denominator bigint not null check \(denominator > 0\)/);
  assert.match(databaseTests, /16mm x 1\/2"/);
  assert.match(databaseTests, /composite does not create extra commercial attributes/);
});

test("inventory derives availability and reserves atomically", async () => {
  const inventory = await migration("20260823110400_inventory.sql");
  assert.match(inventory, /quantity_available bigint generated always as \(quantity_on_hand - quantity_reserved\) stored/);
  assert.match(inventory, /quantity_reserved <= quantity_on_hand/);
  assert.match(inventory, /quantity_on_hand - quantity_reserved >= p_quantity/);
  assert.match(inventory, /create function public\.reserve_inventory/);
  assert.match(inventory, /insert into public\.inventory_movements/);
});

test("all Phase C tables enable RLS without public policies", async () => {
  const sql = (await Promise.all(migrationNames.map(migration))).join("\n");
  const tables = [...sql.matchAll(/create table public\.([a-z_]+) \(/g)].map((match) => match[1]);
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
});

test("F.2 adds durable inbox, checkpoint, search parity and no public policies", async () => {
  const sync = await migration("20260824120000_incremental_sync.sql");
  assert.match(sync, /create table public\.integration_inbox/);
  assert.match(sync, /integration_inbox_event_unique/);
  assert.match(sync, /create table public\.integration_checkpoints/);
  assert.match(sync, /create function public\.catalog_search/);
  assert.match(sync, /enable row level security/g);
  assert.doesNotMatch(sync, /create policy/i);
});

test("F.3 models only required commercial semantics with protected structured tags", async () => {
  const commercial = await migration("20260824130000_catalog_commercial_semantics.sql");
  assert.match(commercial, /is_purchasable boolean not null/);
  assert.match(commercial, /allows_backorder boolean not null/);
  assert.match(commercial, /average_rating numeric\(3,2\)/);
  assert.match(commercial, /create table public\.product_tags/);
  assert.match(commercial, /create table public\.product_tag_assignments/);
  assert.match(commercial, /alter table public\.product_tags enable row level security/);
  assert.doesNotMatch(commercial, /create policy/i);
});
