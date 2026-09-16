// A3.6-A: publication exposability predicate + native batch read model.
// Pure-logic tests run fully offline (no DB). Source-shape tests are
// static-text assertions, matching this repo's established convention
// (see tests/pimA35eP3BStagingQualification.test.mjs) for proving SQL/
// wiring shape without a live database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isPublicationExposable } from "../lib/pim/publication-exposability.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const BASE = {
  publicationState: "published",
  batchStatus: "active",
  sourcePavAttributeValueId: "av-1",
  attributeValueId: "av-1",
  attributeExists: true,
  attributeValueExists: true,
};

test("isPublicationExposable: published + valid => exposable, zero block reasons", () => {
  const result = isPublicationExposable(BASE);
  assert.equal(result.exposable, true);
  assert.deepEqual(result.blockReasons, []);
});

test("isPublicationExposable: unpublished => not exposable (NOT_PUBLISHED)", () => {
  const result = isPublicationExposable({ ...BASE, publicationState: "unpublished" });
  assert.equal(result.exposable, false);
  assert.ok(result.blockReasons.includes("NOT_PUBLISHED"));
});

test("isPublicationExposable: rolled_back batch => not exposable (BATCH_NOT_ACTIVE)", () => {
  const result = isPublicationExposable({ ...BASE, batchStatus: "rolled_back" });
  assert.equal(result.exposable, false);
  assert.ok(result.blockReasons.includes("BATCH_NOT_ACTIVE"));
});

test("isPublicationExposable: orphaned batch (null status, batch row missing) => not exposable, same as rolled_back", () => {
  const result = isPublicationExposable({ ...BASE, batchStatus: null });
  assert.equal(result.exposable, false);
  assert.ok(result.blockReasons.includes("BATCH_NOT_ACTIVE"));
});

test("isPublicationExposable: missing source PAV => not exposable (MISSING_SOURCE_ASSOCIATION)", () => {
  const result = isPublicationExposable({ ...BASE, sourcePavAttributeValueId: null });
  assert.equal(result.exposable, false);
  assert.ok(result.blockReasons.includes("MISSING_SOURCE_ASSOCIATION"));
});

test("isPublicationExposable: source PAV points to a DIFFERENT attribute_value_id => not exposable (IDENTITY_MISMATCH), not silently accepted", () => {
  const result = isPublicationExposable({ ...BASE, sourcePavAttributeValueId: "av-DIFFERENT" });
  assert.equal(result.exposable, false);
  assert.ok(result.blockReasons.includes("IDENTITY_MISMATCH"));
});

test("isPublicationExposable: missing attribute row => not exposable (MISSING_ATTRIBUTE)", () => {
  const result = isPublicationExposable({ ...BASE, attributeExists: false });
  assert.equal(result.exposable, false);
  assert.ok(result.blockReasons.includes("MISSING_ATTRIBUTE"));
});

test("isPublicationExposable: missing attribute_value row => not exposable (MISSING_ATTRIBUTE_VALUE)", () => {
  const result = isPublicationExposable({ ...BASE, attributeValueExists: false });
  assert.equal(result.exposable, false);
  assert.ok(result.blockReasons.includes("MISSING_ATTRIBUTE_VALUE"));
});

test("isPublicationExposable: multiple simultaneous failures are all reported, not just the first", () => {
  const result = isPublicationExposable({ ...BASE, publicationState: "unpublished", batchStatus: "rolled_back", sourcePavAttributeValueId: null });
  assert.equal(result.exposable, false);
  assert.equal(result.blockReasons.length, 3);
});

// ---------- read model: native batch API wiring ----------

test("read model: getPublishedAttributesForProducts routes every row through isPublicationExposable (centralized semantics, not a re-encoded state filter)", async () => {
  const source = await read("lib/pim/publication-read-model.ts");
  const fn = source.slice(source.indexOf("export async function getPublishedAttributesForProducts"));
  assert.match(fn, /isPublicationExposable\(/);
  // Must not re-implement the rule as a bare SQL predicate on this path.
  assert.doesNotMatch(fn.slice(0, fn.indexOf("isPublicationExposable")), /where[\s\S]*state\s*=\s*'published'/);
});

test("read model: getPublishedAttributesForProducts fetches all requested products in ONE query (no per-product loop issuing SQL)", async () => {
  const source = await read("lib/pim/publication-read-model.ts");
  const fn = source.slice(source.indexOf("export async function getPublishedAttributesForProducts"), source.indexOf("export async function getPublishedAttributesForProduct("));
  const sqlCallCount = (fn.match(/getDatabase\(\)\.execute\(sql`/g) ?? []).length;
  assert.equal(sqlCallCount, 1, "expected exactly one batch SQL call, found a possible N+1");
  assert.match(fn, /product_id in \(\$\{sql\.join\(productIds\.map/);
});

test("read model: getPublishedAttributesForProducts always returns an entry for every requested productId, even with zero exposable rows", async () => {
  const source = await read("lib/pim/publication-read-model.ts");
  const fn = source.slice(source.indexOf("export async function getPublishedAttributesForProducts"));
  assert.match(fn, /new Map<string, PublishedAttributeRecord\[\]>\(productIds\.map/);
});

test("read model: batch join defends against orphaned batch via LEFT JOIN pim_publication_batches (not an inner join that would silently drop orphaned rows before the predicate can classify them)", async () => {
  const source = await read("lib/pim/publication-read-model.ts");
  assert.match(source, /left join public\.pim_publication_batches b on b\.id = pap\.batch_id/);
});

test("zero public leak: no file under app/ or components/ imports any lib/pim/publication-* module (foundation stays disconnected from storefront in A3.6-A)", async () => {
  const { execSync } = await import("node:child_process");
  let matches = [];
  try {
    const output = execSync('git grep -l "lib/pim/publication-" -- "app" "components"', { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    matches = output.trim().split("\n").filter(Boolean);
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  assert.deepEqual(matches, []);
});

test("zero public leak: services/catalog/postgres.ts (storefront-facing) still does not reference publication tables or A3.6-A modules", async () => {
  const source = await read("services/catalog/postgres.ts");
  assert.doesNotMatch(source, /pim_attribute_publications|pim_publication_batches|publication-read-model|publication-service|publication-candidate|publication-shadow-comparison/);
});
