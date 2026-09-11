import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const filename = "20260903130000_public_browser_privilege_remediation.sql";
const migration = await readFile(`supabase/migrations/${filename}`, "utf8");
const migrations = (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();

test("security remediation is uniquely ordered between the staging head and B3C", () => {
  assert.equal(migrations.filter((name) => name === filename).length, 1);
  assert.ok(migrations.indexOf("20260903120000_store_price_authority_foundation.sql") < migrations.indexOf(filename));
  assert.ok(migrations.indexOf(filename) < migrations.indexOf("20260904010000_secure_checkout_pii_foundation.sql"));
});

test("security remediation narrows only evidenced table defaults and existing ACLs", () => {
  assert.match(migration, /alter default privileges for role postgres in schema public\s+revoke truncate, references, trigger, maintain on tables from anon, authenticated/i);
  assert.match(migration, /revoke truncate, references, trigger, maintain on all tables in schema public\s+from anon, authenticated/i);
  assert.doesNotMatch(migration, /alter default privileges for role supabase_admin/i);
  assert.doesNotMatch(migration, /revoke all on all tables/i);
});

test("all sixteen server-only functions use explicit signatures", () => {
  const names = [
    "adjust_inventory", "capture_price_history", "catalog_search",
    "confirm_inventory_reservation", "immutable_unaccent_lower",
    "prevent_overlapping_prices", "refresh_catalog_search_document",
    "release_inventory_reservation", "reserve_inventory", "rls_auto_enable",
    "set_updated_at", "validate_attribute_assignment",
    "validate_attribute_value_shape", "validate_measurement_component",
    "validate_product_media_variant", "validate_product_publication",
  ];
  for (const name of names) assert.match(migration, new RegExp(`public\\.${name}\\([^)]*\\)`));
  assert.match(migration, /from public, anon, authenticated/i);
});

test("migration fails closed on effective privileges and preserves platform scope", () => {
  for (const marker of [
    "SECURITY_BROWSER_TABLE_PRIVILEGE_REMAINS",
    "SECURITY_UNSAFE_POSTGRES_TABLE_DEFAULT_REMAINS",
    "SECURITY_BROWSER_SCHEMA_CREATE_REMAINS",
    "SECURITY_PUBLIC_TABLE_MUTATION_REMAINS",
    "SECURITY_BROWSER_FUNCTION_EXECUTE_REMAINS",
  ]) assert.match(migration, new RegExp(marker));
  assert.doesNotMatch(migration, /\b(auth|storage|realtime|graphql)\s*\./i);
  assert.doesNotMatch(migration, /from\s+persi_app|from\s+persi_worker|from\s+service_role/i);
});
