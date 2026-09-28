// A3.7-A-R12: pure guard-layer tests for the minimal publication executor.
// These test ONLY the NEW code this round adds (manifest-shape/target/actor
// guards) -- the underlying publication-service.ts rules (eligibility,
// cross-batch ownership, idempotent replay, rollback) are already covered
// by tests/pimA35eP3APublicationFoundation.test.mjs and friends and are
// exercised end-to-end (not reimplemented) by the disposable qualification
// script, never duplicated here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANARY_MANIFEST,
  EXPECTED_FINGERPRINT,
  validateManifestGuards,
  validateTargetBinding,
  validateActor,
} from "../scripts/database/pim-publication-canary-executor.mjs";

test("R12-guard: the frozen canary manifest passes its own guard (happy path 5/5)", () => {
  const result = validateManifestGuards(CANARY_MANIFEST);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.fingerprint, EXPECTED_FINGERPRINT);
});

test("R12-guard: manifest is exactly 5 associations across exactly 2 SKUs (0117, PVCB5M)", () => {
  assert.equal(CANARY_MANIFEST.length, 5);
  assert.deepEqual([...new Set(CANARY_MANIFEST.map((m) => m.sku))].sort(), ["0117", "PVCB5M"]);
});

test("R12-guard: missing association (4/5) fails fingerprint and count", () => {
  const short = CANARY_MANIFEST.slice(0, 4);
  const result = validateManifestGuards(short);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith("ASSOCIATION_COUNT_MISMATCH")));
  assert.ok(result.errors.some((e) => e.startsWith("FINGERPRINT_MISMATCH")));
});

test("R12-guard: extra association (6/5, a foreign identity appended) fails count and fingerprint", () => {
  const extra = [...CANARY_MANIFEST, { productId: "00000000-0000-0000-0000-000000000000", attributeId: "00000000-0000-0000-0000-000000000001", attributeValueId: "00000000-0000-0000-0000-000000000002", sku: "FOREIGN", attributeCode: "material", canonicalValue: "X" }];
  const result = validateManifestGuards(extra);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith("ASSOCIATION_COUNT_MISMATCH")));
  assert.ok(result.errors.some((e) => e.startsWith("SKU_MISMATCH")));
  assert.ok(result.errors.some((e) => e.startsWith("FINGERPRINT_MISMATCH")));
});

test("R12-guard: wrong SKU (substituting a member's sku) fails SKU_MISMATCH even at the correct count", () => {
  const wrongSku = CANARY_MANIFEST.map((m, i) => (i === 0 ? { ...m, sku: "UNEXPECTED-SKU" } : m));
  const result = validateManifestGuards(wrongSku);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith("SKU_MISMATCH")));
});

test("R12-guard: wrong fingerprint (a tampered attributeValueId) is caught even when count/SKU look right", () => {
  const tampered = CANARY_MANIFEST.map((m, i) => (i === 0 ? { ...m, attributeValueId: "ffffffff-ffff-ffff-ffff-ffffffffffff" } : m));
  const result = validateManifestGuards(tampered);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith("FINGERPRINT_MISMATCH")));
});

test("R12-guard: target=production is rejected", () => {
  const result = validateTargetBinding("postgres://postgres.vtrujmhhkmvjzfklzxip:secret@host:5432/postgres", "production");
  assert.equal(result.ok, false);
  assert.match(result.reason, /^TARGET_INVALID:production$/);
});

test("R12-guard: missing target is rejected", () => {
  const result = validateTargetBinding("postgres://postgres.vtrujmhhkmvjzfklzxip:secret@host:5432/postgres", undefined);
  assert.equal(result.ok, false);
  assert.match(result.reason, /^TARGET_INVALID:MISSING$/);
});

test("R12-guard: unknown target string is rejected the same way as production (single-value allowlist, no substring logic)", () => {
  const result = validateTargetBinding("postgres://postgres.vtrujmhhkmvjzfklzxip:secret@host:5432/postgres", "staging-2");
  assert.equal(result.ok, false);
  assert.match(result.reason, /^TARGET_INVALID:staging-2$/);
});

test("R12-guard: target=staging but DATABASE_URL bound to a different project ref is rejected (semantic check, not hostname substring)", () => {
  const result = validateTargetBinding("postgres://postgres.someotherproject:secret@host:5432/postgres", "staging");
  assert.equal(result.ok, false);
  assert.match(result.reason, /^PROJECT_REF_MISMATCH:someotherproject$/);
});

test("R12-guard: target=staging with a hostname that merely CONTAINS the word staging, but wrong project ref, is still rejected", () => {
  // Proves the guard is NOT a hostname substring check -- a URL that looks
  // like it says "staging" in it must still fail if the real project ref differs.
  const result = validateTargetBinding("postgres://postgres.wrongref:secret@staging.example.com:5432/postgres", "staging");
  assert.equal(result.ok, false);
  assert.match(result.reason, /^PROJECT_REF_MISMATCH:wrongref$/);
});

test("R12-guard: target=staging with the real expected project ref is accepted", () => {
  const result = validateTargetBinding("postgres://postgres.vtrujmhhkmvjzfklzxip:secret@host:5432/postgres", "staging");
  assert.equal(result.ok, true);
  assert.equal(result.projectRef, "vtrujmhhkmvjzfklzxip");
});

test("R12-guard: missing DATABASE_URL is rejected even with target=staging", () => {
  // Empty string, not undefined -- checkDatabaseBinding's own default
  // parameter falls back to the real process.env.DATABASE_URL when given
  // undefined, which would defeat this test in an environment where a real
  // DATABASE_URL happens to be set. An explicit "" cannot be masked that way.
  const result = validateTargetBinding("", "staging");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "DATABASE_URL_MISSING");
});

test("R12-guard: missing actor is rejected", () => {
  const result = validateActor(undefined);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ACTOR_REQUIRED");
});

test("R12-guard: blank/whitespace-only actor is rejected", () => {
  const result = validateActor("   ");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ACTOR_REQUIRED");
});

test("R12-guard: overly long actor is rejected", () => {
  const result = validateActor("x".repeat(201));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "ACTOR_TOO_LONG");
});

test("R12-guard: a normal actor string is accepted and trimmed", () => {
  const result = validateActor("  eduardo.persi@hotmail.com  ");
  assert.equal(result.ok, true);
  assert.equal(result.actor, "eduardo.persi@hotmail.com");
});

test("R12-guard: DATABASE_URL is never echoed back by validateTargetBinding's result", () => {
  const url = "postgres://postgres.vtrujmhhkmvjzfklzxip:supersecretpassword@host:5432/postgres";
  const result = validateTargetBinding(url, "staging");
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("supersecretpassword"));
  assert.ok(!serialized.includes(url));
});
