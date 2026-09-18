// A3.7-A-R15: pure-function tests for the Ficha Técnica canary merge
// matrix (lib/pim/publication-ficha-tecnica.ts), qualified locally per
// A3.7-A-R14-R5's design. Zero I/O, zero DB, zero network -- matches this
// repo's own established pattern for testing the comparator itself
// (tests/pimA36AShadowComparison.test.mjs), which this file deliberately
// never re-tests: compareOfficialWithPimCandidate's own correctness is
// already proven there; this file only proves what buildFichaTecnicaSpecifications
// DOES with that comparison's real output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPimCatalogCandidate } from "../lib/pim/publication-candidate.ts";
import { buildFichaTecnicaSpecifications } from "../lib/pim/publication-ficha-tecnica.ts";

function official(sku, attributes) {
  return { sku, attributes, attributeCount: attributes.length };
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

test("PIM_ONLY: adds a new specification when Woo has nothing under any code for it", () => {
  const off = official("SKU-1", [{ code: "pa_cor", name: "Cor", value: "Branco" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "material", attributeName: "Material", canonicalValue: "PVC" })]);
  const { specifications, observableDifferences } = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(specifications, [
    { label: "Cor", value: "Branco" },
    { label: "Material", value: "PVC" },
  ]);
  assert.deepEqual(observableDifferences, []);
});

test("MATCH: does not duplicate -- Woo's own entry is kept exactly, no second PIM-labeled row", () => {
  const off = official("SKU-1", [{ code: "pa_material", name: "Material", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ canonicalValue: "PVC" })]);
  const { specifications, observableDifferences } = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(specifications, [{ label: "Material", value: "PVC" }]);
  assert.equal(specifications.length, 1);
  assert.deepEqual(observableDifferences, []);
});

test("MATCH via vocabulary reconciliation (A3.7-A-R8's canonicalizeOfficialAttributeCode): pa_material still deduplicates, never shown twice", () => {
  const off = official("SKU-1", [{ code: "pa_material", name: "Material", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "material", canonicalValue: "PVC" })]);
  const { specifications } = buildFichaTecnicaSpecifications(off, candidate);
  assert.equal(specifications.length, 1);
  assert.deepEqual(specifications[0], { label: "Material", value: "PVC" });
});

test("ORDER_ONLY_DIFFERENCE (multi-value, same set, different order): treated like MATCH -- no duplicate", () => {
  const off = official("SKU-1", [
    { code: "pa_conexao", name: "Conexão", value: "Soldável" },
    { code: "pa_conexao", name: "Conexão", value: "Roscável" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-1", [
    record({ attributeSlug: "conexao", attributeName: "Conexão", canonicalValue: "Roscável", attributeValueId: "av-1" }),
    record({ attributeSlug: "conexao", attributeName: "Conexão", canonicalValue: "Soldável", attributeValueId: "av-2" }),
  ]);
  const { specifications, observableDifferences } = buildFichaTecnicaSpecifications(off, candidate);
  assert.equal(specifications.length, 1);
  assert.equal(specifications[0].label, "Conexão");
  assert.deepEqual(observableDifferences, []);
});

test("OFFICIAL_ONLY: Woo's own entry is kept exactly, PIM contributes nothing", () => {
  const off = official("SKU-1", [{ code: "pa_marca", name: "Marca", value: "Krona" }]);
  const candidate = buildPimCatalogCandidate("prod-1", []);
  const { specifications, observableDifferences } = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(specifications, [{ label: "Marca", value: "Krona" }]);
  assert.deepEqual(observableDifferences, []);
});

test("VALUE_DIFFERENCE: NEVER overwrites Woo -- Woo's value is kept exactly, PIM never shown, difference reported separately", () => {
  const off = official("SKU-1", [{ code: "pa_material", name: "Material", value: "Aço" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ canonicalValue: "PVC" })]);
  const { specifications, observableDifferences } = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(specifications, [{ label: "Material", value: "Aço" }]);
  assert.equal(observableDifferences.length, 1);
  assert.equal(observableDifferences[0].classification, "VALUE_DIFFERENCE");
  assert.equal(observableDifferences[0].code, "material");
});

test("MULTI_VALUE_DIFFERENCE: NEVER overwrites Woo -- fail closed, same as VALUE_DIFFERENCE", () => {
  const off = official("SKU-1", [
    { code: "pa_conexao", name: "Conexão", value: "Roscável" },
    { code: "pa_conexao", name: "Conexão", value: "Soldável" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "conexao", attributeName: "Conexão", canonicalValue: "Compressão" })]);
  const { specifications, observableDifferences } = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(specifications, [{ label: "Conexão", value: "Roscável, Soldável" }]);
  assert.equal(observableDifferences.length, 1);
  assert.equal(observableDifferences[0].classification, "MULTI_VALUE_DIFFERENCE");
});

test("UNRESOLVABLE: PIM is never added and the difference is reported separately -- Woo's own (even if malformed) base entry is left exactly as it would render today, untouched", () => {
  const off = official("SKU-1", [{ code: "pa_material", name: "Material", value: null }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ canonicalValue: "PVC" })]);
  const { specifications, observableDifferences } = buildFichaTecnicaSpecifications(off, candidate);
  // Woo's own entry (however malformed) is never removed by this merge --
  // only ADDING PIM is ever suppressed. `[null].join(", ")` renders "",
  // identical to what ProductDetails's own existing Woo-only fallback would
  // already produce for a null term name -- not a new behavior.
  assert.deepEqual(specifications, [{ label: "Material", value: "" }]);
  assert.equal(observableDifferences.length, 1);
  assert.equal(observableDifferences[0].classification, "UNRESOLVABLE");
});

test("BLOCKED (KNOWN_NEEDS_REVIEW_REGISTRY hit): never added, defense in depth even though a genuinely published row should not reach this state", () => {
  const off = official("PA013710", [{ code: "pa_comprimento", name: "Comprimento", value: "1,5m" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "comprimento", attributeName: "Comprimento", canonicalValue: "1 Metro" })]);
  const { specifications, observableDifferences } = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(specifications, [{ label: "Comprimento", value: "1,5m" }]);
  assert.deepEqual(observableDifferences, []); // BLOCKED is not VALUE_DIFFERENCE/MULTI/UNRESOLVABLE -- not reported as an observable difference either, just silently never exposed
});

test("compound value preservation: '25mm x 1/2\"' survives PIM_ONLY addition verbatim, never split/converted", () => {
  const off = official("SKU-1", []);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "bitola", attributeName: "Bitola", canonicalValue: '25mm x 1/2"' })]);
  const { specifications } = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(specifications, [{ label: "Bitola", value: '25mm x 1/2"' }]);
});

test("compound value preservation: a MATCH on a compound value is not decomposed either", () => {
  // Uses "comprimento", one of the 4 codes canonicalizeOfficialAttributeCode
  // actually reconciles (pa_comprimento -> comprimento) -- required for the
  // comparator to classify this as MATCH at all instead of two disjoint
  // OFFICIAL_ONLY/PIM_ONLY entries. See the residual-risk test below for
  // what happens with a code outside that reconciled set.
  const off = official("SKU-1", [{ code: "pa_comprimento", name: "Comprimento", value: '25mm x 1/2"' }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "comprimento", attributeName: "Comprimento", canonicalValue: '25mm x 1/2"' })]);
  const { specifications } = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(specifications, [{ label: "Comprimento", value: '25mm x 1/2"' }]);
});

test("residual risk (currently unreachable in production): an unreconciled official code with the same display name as an unrelated PIM code produces a duplicate-labeled entry instead of a MATCH -- structurally prevented today only because publishBatch()'s ATTRIBUTE_NOT_SUPPORTED gate rejects any code outside material/conexao/comprimento/volume before it can ever become a published candidate", () => {
  const off = official("SKU-1", [{ code: "pa_bitola", name: "Bitola", value: '25mm x 1/2"' }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "bitola", attributeName: "Bitola", canonicalValue: '25mm x 1/2"' })]);
  const { specifications } = buildFichaTecnicaSpecifications(off, candidate);
  // "pa_bitola" is not canonicalized, so the comparator sees two different
  // codes ("pa_bitola" official-only, "bitola" PIM-only) that happen to
  // share the human label "Bitola" -- both get rendered, producing a
  // duplicate. Documented, not fixed: unreachable while eligibility gating
  // holds "bitola" out of any real candidate.
  assert.deepEqual(specifications, [
    { label: "Bitola", value: '25mm x 1/2"' },
    { label: "Bitola", value: '25mm x 1/2"' },
  ]);
});

test("deterministic ordering: Woo's own order is preserved first, PIM_ONLY additions appended alphabetically by code", () => {
  const off = official("SKU-1", [
    { code: "pa_marca", name: "Marca", value: "Krona" },
    { code: "pa_cor", name: "Cor", value: "Branco" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-1", [
    record({ attributeSlug: "material", attributeName: "Material", canonicalValue: "PVC", attributeId: "attr-mat" }),
    record({ attributeSlug: "comprimento", attributeName: "Comprimento", canonicalValue: "6m", attributeId: "attr-comp", attributeValueId: "av-comp" }),
  ]);
  const { specifications } = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(specifications.map((s) => s.label), ["Marca", "Cor", "Comprimento", "Material"]); // Marca/Cor: Woo array order preserved; comprimento < material alphabetically by code
});

test("running the same inputs twice produces byte-identical output (deterministic, no timing/UUID/order-of-network dependency)", () => {
  const off = official("SKU-1", [{ code: "pa_marca", name: "Marca", value: "Krona" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "material", canonicalValue: "PVC" })]);
  const first = buildFichaTecnicaSpecifications(off, candidate);
  const second = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(first.specifications, second.specifications);
});

test("no duplicate attribute labels in the final specification list", () => {
  const off = official("SKU-1", [
    { code: "pa_marca", name: "Marca", value: "Krona" },
    { code: "pa_material", name: "Material", value: "PVC" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-1", [
    record({ attributeSlug: "material", canonicalValue: "PVC" }),
    record({ attributeSlug: "comprimento", attributeName: "Comprimento", canonicalValue: "6m", attributeId: "attr-comp", attributeValueId: "av-comp" }),
  ]);
  const { specifications } = buildFichaTecnicaSpecifications(off, candidate);
  const labels = specifications.map((s) => s.label);
  assert.equal(new Set(labels).size, labels.length, `expected no duplicate labels, got: ${JSON.stringify(labels)}`);
});

test("multi-value PIM_ONLY (a canary product with more than one value under the same code) joins values exactly like Woo's own multi-value rendering", () => {
  const off = official("SKU-1", []);
  const candidate = buildPimCatalogCandidate("prod-1", [
    record({ attributeSlug: "conexao", attributeName: "Conexão", canonicalValue: "Roscável", attributeValueId: "av-1" }),
    record({ attributeSlug: "conexao", attributeName: "Conexão", canonicalValue: "Soldável", attributeValueId: "av-2" }),
  ]);
  const { specifications } = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(specifications, [{ label: "Conexão", value: "Roscável, Soldável" }]);
});

test("empty PIM result: candidate has zero attributes -> specifications is exactly Woo's own list, unchanged", () => {
  const off = official("SKU-1", [
    { code: "pa_cor", name: "Cor", value: "Branco" },
    { code: "pa_marca", name: "Marca", value: "Krona" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-1", []);
  const { specifications, observableDifferences } = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(specifications, [
    { label: "Cor", value: "Branco" },
    { label: "Marca", value: "Krona" },
  ]);
  assert.deepEqual(observableDifferences, []);
});

test("input immutability: neither `official` nor `candidate` is mutated by the merge", () => {
  const off = official("SKU-1", [{ code: "pa_marca", name: "Marca", value: "Krona" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "material", canonicalValue: "PVC" })]);
  const offCopy = JSON.parse(JSON.stringify(off));
  const candidateCopy = JSON.parse(JSON.stringify(candidate));
  buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(off, offCopy);
  assert.deepEqual(candidate, candidateCopy);
});

test("mixed official + PIM attributes: a realistic multi-attribute product (Cor/Marca official, comprimento/conexao/material PIM_ONLY) merges correctly in one pass -- mirrors the real 0117 canary shape", () => {
  const off = official("0117", [
    { code: "pa_cor", name: "Cor", value: "Branco" },
    { code: "pa_marca", name: "Marca", value: "Krona" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-0117", [
    record({ attributeSlug: "comprimento", attributeName: "Comprimento", canonicalValue: "6m", attributeId: "attr-comp", attributeValueId: "av-comp" }),
    record({ attributeSlug: "conexao", attributeName: "Conexão", canonicalValue: "Roscável", attributeId: "attr-con", attributeValueId: "av-con" }),
    record({ attributeSlug: "material", attributeName: "Material", canonicalValue: "PVC", attributeId: "attr-mat", attributeValueId: "av-mat" }),
  ]);
  const { specifications, observableDifferences } = buildFichaTecnicaSpecifications(off, candidate);
  assert.deepEqual(specifications, [
    { label: "Cor", value: "Branco" },
    { label: "Marca", value: "Krona" },
    { label: "Comprimento", value: "6m" },
    { label: "Conexão", value: "Roscável" },
    { label: "Material", value: "PVC" },
  ]);
  assert.deepEqual(observableDifferences, []);
});
