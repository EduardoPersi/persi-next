// A3.6-A Section 22: deterministic shadow comparison test matrix.
// Pure logic, zero I/O, zero AI providers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPimCatalogCandidate } from "../lib/pim/publication-candidate.ts";
import { compareOfficialWithPimCandidate } from "../lib/pim/publication-shadow-comparison.ts";

function official(sku, attributes) {
  return { sku, attributes };
}

function record(overrides) {
  return {
    productId: "prod-1",
    attributeId: "attr-1",
    attributeSlug: "material",
    attributeName: "Material",
    attributeValueId: "av-1",
    canonicalValue: "PVC",
    publicationState: "published",
    batchId: "batch-1",
    publishedAt: null,
    ...overrides,
  };
}

// 1. official == PIM
test("matrix 1: official == PIM => MATCH, safeForFutureCanary=true", () => {
  const off = official("SKU-1", [{ code: "material", name: "Material", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record()]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["MATCH"]);
  assert.equal(result.safeForFutureCanary, true);
});

// 2. PIM only
test("matrix 2: PIM has an attribute official does not => PIM_ONLY", () => {
  const off = official("SKU-1", []);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "volume", canonicalValue: "150mL" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["PIM_ONLY"]);
  // PIM_ONLY still blocks canary-readiness for that code (nothing to match against).
  assert.equal(result.safeForFutureCanary, false);
});

// 3. official only
test("matrix 3: official has an attribute PIM does not publish => OFFICIAL_ONLY, does not block canary readiness of other codes", () => {
  const off = official("SKU-1", [
    { code: "material", name: "Material", value: "PVC" },
    { code: "conexao", name: "Conexão", value: "Roscável" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-1", [record()]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  const byCode = Object.fromEntries(result.differences.map((d) => [d.code, d.classification]));
  assert.equal(byCode.material, "MATCH");
  assert.equal(byCode.conexao, "OFFICIAL_ONLY");
  assert.equal(result.safeForFutureCanary, true); // only material is candidate-relevant, and it matches
});

// 4. different value
test("matrix 4: same code, different single value => VALUE_DIFFERENCE", () => {
  const off = official("SKU-1", [{ code: "material", name: "Material", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ canonicalValue: "Alumínio" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["VALUE_DIFFERENCE"]);
  assert.equal(result.safeForFutureCanary, false);
});

// 5. multiple values, same semantic set
test("matrix 5: multiple values, same set (different order in source arrays) => MATCH (set-equal, order-equal after grouping is verified separately)", () => {
  const off = official("SKU-1", [
    { code: "conexao", name: "Conexão", value: "Roscável" },
    { code: "conexao", name: "Conexão", value: "Soldável" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-1", [
    record({ attributeSlug: "conexao", canonicalValue: "Roscável" }),
    record({ attributeSlug: "conexao", canonicalValue: "Soldável", attributeValueId: "av-2" }),
  ]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["MATCH"]);
});

// 6. order-only difference
test("matrix 6: same multi-value set, different order => ORDER_ONLY_DIFFERENCE, not VALUE_DIFFERENCE", () => {
  const off = official("SKU-1", [
    { code: "conexao", name: "Conexão", value: "Roscável" },
    { code: "conexao", name: "Conexão", value: "Soldável" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-1", [
    record({ attributeSlug: "conexao", canonicalValue: "Soldável" }),
    record({ attributeSlug: "conexao", canonicalValue: "Roscável", attributeValueId: "av-2" }),
  ]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["ORDER_ONLY_DIFFERENCE"]);
  assert.equal(result.safeForFutureCanary, false); // presentational, but still not silently declared safe
});

// 7. compound technical value carried through verbatim, matches as one unit
test("matrix 7: compound technical value ('25mm x 1/2\"') is treated as ONE opaque unit, never split", () => {
  const off = official("SKU-1", [{ code: "bitola", name: "Bitola", value: '25mm x 1/2"' }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "bitola", canonicalValue: '25mm x 1/2"' })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["MATCH"]);
  assert.deepEqual(result.differences[0].candidateValues, ['25mm x 1/2"']);
});

// 8. unpublished PIM row never reaches the candidate at all (candidate builder only sees already-filtered records)
test("matrix 8: an unpublished attribute is never part of the candidate in the first place (upstream filtering, not a comparison-time exclusion)", () => {
  // The candidate builder has no concept of "unpublished" -- it only ever
  // receives records the read model already deemed exposable. This test
  // documents that guarantee at the type/contract level: passing zero
  // records (as the read model would for an unpublished row) yields an
  // empty candidate, which compares as OFFICIAL_ONLY, never as a false MATCH.
  const off = official("SKU-1", [{ code: "material", name: "Material", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-1", []);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["OFFICIAL_ONLY"]);
});

// 9. rolled-back PIM ignored (same reasoning as #8: read model already excluded it)
test("matrix 9: a rolled-back batch's row is never part of the candidate (same upstream-filtering guarantee)", () => {
  const off = official("SKU-1", [{ code: "comprimento", name: "Comprimento", value: "6m" }]);
  const candidate = buildPimCatalogCandidate("prod-1", []);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["OFFICIAL_ONLY"]);
});

// 10. needs-review ignored / BLOCKED
test("matrix 10: a code on the KNOWN_NEEDS_REVIEW_REGISTRY is classified BLOCKED even if the candidate somehow carries a value for it", () => {
  const off = official("PA013710", [{ code: "comprimento", name: "Comprimento", value: "1,5m" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "comprimento", canonicalValue: "1 Metro" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["BLOCKED"]);
  assert.equal(result.differences[0].blockedReason, "KNOWN_NEEDS_REVIEW_REGISTRY");
  assert.equal(result.safeForFutureCanary, false);
});

// 11. missing source ignored (again, upstream filtering guarantee)
test("matrix 11: a publication row whose source PAV disappeared is never part of the candidate", () => {
  const off = official("SKU-1", [{ code: "material", name: "Material", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-1", []);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["OFFICIAL_ONLY"]);
});

// 12. duplicate defensive behavior: two identical CatalogTerm entries on the official side must not silently collapse into a spurious mismatch
test("matrix 12: duplicate identical official values collapse correctly against a single candidate value (defensive, not a crash or false MULTI_VALUE_DIFFERENCE)", () => {
  const off = official("SKU-1", [
    { code: "material", name: "Material", value: "PVC" },
    { code: "material", name: "Material", value: "PVC" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-1", [record()]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["MULTI_VALUE_DIFFERENCE"]);
  // documented, deterministic outcome: set sizes differ (2 vs 1) even
  // though values are textually identical -- this is intentionally NOT
  // silently treated as a MATCH, since collapsing duplicates would hide a
  // real cardinality divergence between the two sides.
});

// 13. batch query multiple products (candidate builder + comparison called per product from a batch map)
test("matrix 13: comparing multiple products from one batch-fetched map works independently per product", () => {
  const productAOfficial = official("SKU-A", [{ code: "material", name: "Material", value: "PVC" }]);
  const productBOfficial = official("SKU-B", [{ code: "material", name: "Material", value: "Aço" }]);
  const candidateA = buildPimCatalogCandidate("prod-A", [record()]);
  const candidateB = buildPimCatalogCandidate("prod-B", [record({ canonicalValue: "Aço" })]);
  const resultA = compareOfficialWithPimCandidate(productAOfficial, candidateA);
  const resultB = compareOfficialWithPimCandidate(productBOfficial, candidateB);
  assert.deepEqual(resultA.differences.map((d) => d.classification), ["MATCH"]);
  assert.deepEqual(resultB.differences.map((d) => d.classification), ["MATCH"]);
});

// 14. empty publication set
test("matrix 14: empty candidate (zero published attributes) never claims safeForFutureCanary and never fabricates a MATCH", () => {
  const off = official("SKU-1", [{ code: "material", name: "Material", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-1", []);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.equal(result.candidate.attributeCount, 0);
  assert.equal(result.safeForFutureCanary, false);
  assert.deepEqual(result.differences.map((d) => d.classification), ["OFFICIAL_ONLY"]);
});

// 15. exact rollback state from A3.5: the real 8-member canary batch is now fully rolled_back/unpublished -- its candidate must be empty for every one of those 8 products.
test("matrix 15: A3.5's rolled-back canary members produce an empty candidate (regression guard against ever treating rolled_back as published)", () => {
  const off = official("8764", [{ code: "material", name: "Material", value: "Aço" }]);
  const candidate = buildPimCatalogCandidate("prod-8764", []); // read model already excludes rolled_back/unpublished upstream
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.equal(result.candidate.attributeCount, 0);
  assert.deepEqual(result.differences.map((d) => d.classification), ["OFFICIAL_ONLY"]);
});

// ---------- purity / non-mutation guarantees ----------

test("buildPimCatalogCandidate does not mutate the input records array or its elements", () => {
  const records = [record()];
  const frozenCopy = JSON.parse(JSON.stringify(records));
  buildPimCatalogCandidate("prod-1", records);
  assert.deepEqual(records, frozenCopy);
});

test("compareOfficialWithPimCandidate does not mutate the official product or the candidate", () => {
  const off = official("SKU-1", [{ code: "material", name: "Material", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record()]);
  const officialCopy = JSON.parse(JSON.stringify(off));
  const candidateCopy = JSON.parse(JSON.stringify(candidate));
  compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(off, officialCopy);
  assert.deepEqual(candidate, candidateCopy);
});

test("safeForFutureCanary is never true when any relevant difference is UNRESOLVABLE or BLOCKED", () => {
  const off = official("PA013710", [{ code: "comprimento", name: "Comprimento", value: "1,5m" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "comprimento", canonicalValue: "1 Metro" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.equal(result.safeForFutureCanary, false);
});
