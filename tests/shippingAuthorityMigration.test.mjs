import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/20260905130000_checkout_shipping_authority.sql", import.meta.url);
const sql = await readFile(migrationPath, "utf8");

test("R1D-R2A canonical fingerprint is null-safe and structured", () => {
  const helper = sql.slice(sql.indexOf("create function public.canonical_checkout_logistics_fingerprint"), sql.indexOf("create function public.reject_checkout_shipping_evidence_mutation"));
  assert.doesNotMatch(helper, /\bstrict\b/i);
  assert.match(helper, /jsonb_build_array/);
  assert.match(helper, /to_jsonb\(p_shipping_method_id\)/);
  assert.match(helper, /to_jsonb\(p_estimated_delivery_days\)/);
  assert.match(helper, /to_jsonb\(case when p_provider_quote_reference is null/);
  assert.match(helper, /INVALID_SHIPPING_FINGERPRINT_INPUT/);
  assert.match(helper, /language plpgsql stable/);
});

test("R1D-R2A creation and readiness use the same canonical helper", () => {
  assert.equal((sql.match(/public\.canonical_checkout_logistics_fingerprint\(/g) ?? []).length, 4);
  assert.doesNotMatch(sql, /p_canonical_fingerprint/);
  assert.match(sql, /logistics_version text not null default 'shipping-authority-v1'/);
  assert.match(sql, /SHIPPING_EVIDENCE_IDEMPOTENCY_CONFLICT/);
  assert.match(sql, /is distinct from \(case when p_provider_quote_reference is null/);
  assert.doesNotMatch(sql, /s\.currency<>'BRL'/);
});

test("R1D-R2A FK and authority security remain explicit", () => {
  assert.match(sql, /unique\(id,checkout_session_id\)/i);
  assert.match(sql, /foreign key\(shipping_evidence_id,checkout_session_id\)/i);
  assert.match(sql, /checkout_shipping_evidence enable row level security/i);
  assert.match(sql, /revoke all on public\.checkout_shipping_evidence/i);
});
