// A3.7-A-R8: official (Woo taxonomy) <-> PIM (public.attributes.code)
// attribute vocabulary reconciliation. Pure logic, zero I/O, zero AI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPimCatalogCandidate } from "../lib/pim/publication-candidate.ts";
import { compareOfficialWithPimCandidate, canonicalizeOfficialAttributeCode } from "../lib/pim/publication-shadow-comparison.ts";
import { SUPPORTED_ATTRIBUTE_CODES } from "../lib/pim/publication-eligibility.ts";

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

// ---------- Fase 5, cases 1-6: reconciled global-attribute codes ----------

test("R8-1: official pa_material=PVC, PIM material=PVC => MATCH", () => {
  const off = official("SKU-1", [{ code: "pa_material", name: "Material", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "material", canonicalValue: "PVC" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["MATCH"]);
  assert.equal(result.differences[0].code, "material");
  assert.equal(result.safeForFutureCanary, true);
});

test("R8-2: official pa_material=Aço, PIM material=PVC => VALUE_DIFFERENCE", () => {
  const off = official("SKU-1", [{ code: "pa_material", name: "Material", value: "Aço" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "material", canonicalValue: "PVC" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["VALUE_DIFFERENCE"]);
  assert.equal(result.safeForFutureCanary, false);
});

test("R8-3: official pa_comprimento=6m, PIM comprimento=6m => MATCH", () => {
  const off = official("SKU-1", [{ code: "pa_comprimento", name: "Comprimento", value: "6m" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "comprimento", canonicalValue: "6m" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["MATCH"]);
});

test("R8-4: official pa_comprimento=5m, PIM comprimento=6m => VALUE_DIFFERENCE", () => {
  const off = official("SKU-1", [{ code: "pa_comprimento", name: "Comprimento", value: "5m" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "comprimento", canonicalValue: "6m" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["VALUE_DIFFERENCE"]);
});

test("R8-5: official pa_conexao=Roscável, PIM conexao=Roscável => MATCH", () => {
  const off = official("SKU-1", [{ code: "pa_conexao", name: "Conexão", value: "Roscável" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "conexao", canonicalValue: "Roscável" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["MATCH"]);
});

test("R8-6: official pa_volume=400ml, PIM volume=400ml => MATCH", () => {
  const off = official("SKU-1", [{ code: "pa_volume", name: "Volume", value: "400ml" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "volume", canonicalValue: "400ml" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["MATCH"]);
});

// ---------- Fase 5, case 7: unknown official code never auto-equated ----------

test("R8-7: an unrecognized official code (pa_unknown) is never auto-equated to an unrelated PIM code (unknown)", () => {
  const off = official("SKU-1", [{ code: "pa_unknown", name: "Unknown", value: "X" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "unknown", canonicalValue: "X" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  const byCode = Object.fromEntries(result.differences.map((d) => [d.code, d.classification]));
  assert.equal(byCode.pa_unknown, "OFFICIAL_ONLY");
  assert.equal(byCode.unknown, "PIM_ONLY");
  assert.equal(Object.keys(byCode).length, 2);
  assert.equal(result.safeForFutureCanary, false);
});

// ---------- Fase 5/Fase 3, case 8: Woo LOCAL attribute (no taxonomy) never auto-matched ----------

test("R8-8: a Woo LOCAL attribute (taxonomy=null, code falls back to a human name) is never auto-matched to a PIM code, even when the name looks related", () => {
  // Mirrors services/catalog/woocommerce.ts's real fallback: `attribute.taxonomy ?? attribute.name`.
  const off = official("SKU-1", [{ code: "Material do produto", name: "Material do produto", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "material", canonicalValue: "PVC" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  const byCode = Object.fromEntries(result.differences.map((d) => [d.code, d.classification]));
  assert.equal(byCode["Material do produto"], "OFFICIAL_ONLY");
  assert.equal(byCode.material, "PIM_ONLY");
  assert.equal(Object.keys(byCode).length, 2);
});

// ---------- Fase 5, cases 9-11: existing behavior must not regress ----------

test("R8-9: PIM_ONLY still fires when the attribute genuinely does not exist on the official side (R6C real-world shape: Cor/Marca only)", () => {
  const off = official("0117", [
    { code: "pa_cor", name: "Cor", value: "Branco" },
    { code: "pa_marca", name: "Marca", value: "Krona" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-1", [
    record({ attributeSlug: "comprimento", canonicalValue: "6m", attributeValueId: "av-1" }),
    record({ attributeSlug: "conexao", canonicalValue: "Roscável", attributeValueId: "av-2" }),
    record({ attributeSlug: "material", canonicalValue: "PVC", attributeValueId: "av-3" }),
  ]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  const byCode = Object.fromEntries(result.differences.map((d) => [d.code, d.classification]));
  assert.equal(byCode.comprimento, "PIM_ONLY");
  assert.equal(byCode.conexao, "PIM_ONLY");
  assert.equal(byCode.material, "PIM_ONLY");
  assert.equal(byCode.pa_cor, "OFFICIAL_ONLY");
  assert.equal(byCode.pa_marca, "OFFICIAL_ONLY");
  assert.equal(result.safeForFutureCanary, false);
});

test("R8-10: OFFICIAL_ONLY still fires when the official side has a reconciled-vocabulary code the PIM candidate does not publish", () => {
  const off = official("SKU-1", [{ code: "pa_material", name: "Material", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-1", []);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["OFFICIAL_ONLY"]);
  assert.equal(result.differences[0].code, "material");
});

test("R8-11: KNOWN_NEEDS_REVIEW_REGISTRY still fails closed (BLOCKED) after canonicalization -- and is now actually reachable via the real pa_-prefixed code", () => {
  const off = official("PA013710", [{ code: "pa_comprimento", name: "Comprimento", value: "1,5m" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "comprimento", canonicalValue: "1 Metro" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["BLOCKED"]);
  assert.equal(result.differences[0].blockedReason, "KNOWN_NEEDS_REVIEW_REGISTRY");
  assert.equal(result.safeForFutureCanary, false);
});

// ---------- Fase 5, case 12: canonicalization must not hide a real value difference ----------

test("R8-12: canonicalization never hides a real value difference (multi-value case classifies as MULTI_VALUE_DIFFERENCE, not silently as MATCH)", () => {
  const off = official("SKU-1", [
    { code: "pa_conexao", name: "Conexão", value: "Roscável" },
    { code: "pa_conexao", name: "Conexão", value: "Soldável" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "conexao", canonicalValue: "Roscável" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["MULTI_VALUE_DIFFERENCE"]);
  assert.equal(result.safeForFutureCanary, false);
});

// ---------- Fase 5, case 13: compound measures remain opaque under canonicalization ----------

test("R8-13: a compound technical value survives canonicalization verbatim, never split or unit-transformed", () => {
  const off = official("SKU-1", [{ code: "pa_comprimento", name: "Comprimento", value: '25mm x 1/2"' }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "comprimento", canonicalValue: '25mm x 1/2"' })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["MATCH"]);
  assert.deepEqual(result.differences[0].officialValues, ['25mm x 1/2"']);
  assert.deepEqual(result.differences[0].candidateValues, ['25mm x 1/2"']);
});

// ---------- Fase 5, case 14 / Fase 4: official response invariance ----------

test("R8-14: compareOfficialWithPimCandidate does not mutate the official product or the candidate when canonicalization applies", () => {
  const off = official("SKU-1", [{ code: "pa_material", name: "Material", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-1", [record({ attributeSlug: "material", canonicalValue: "PVC" })]);
  const officialCopy = JSON.parse(JSON.stringify(off));
  const candidateCopy = JSON.parse(JSON.stringify(candidate));
  compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(off, officialCopy);
  assert.deepEqual(candidate, candidateCopy);
});

// ---------- Fase 6: collision safety ----------

test("R8-collision: the four reconciled official codes map onto four distinct, SUPPORTED_ATTRIBUTE_CODES-only targets, with no ambiguity", () => {
  const officialCodes = ["pa_material", "pa_conexao", "pa_comprimento", "pa_volume"];
  const targets = officialCodes.map(canonicalizeOfficialAttributeCode);
  // every target is one of the four codes the publication layer actually recognizes
  for (const target of targets) assert.ok(SUPPORTED_ATTRIBUTE_CODES.includes(target), `${target} must be a SUPPORTED_ATTRIBUTE_CODE`);
  // bijective: 4 distinct official codes -> 4 distinct PIM codes, no two collapsing into one
  assert.equal(new Set(targets).size, 4);
  assert.deepEqual(new Set(targets), new Set(SUPPORTED_ATTRIBUTE_CODES));
});

test("R8-collision: unrecognized or already-canonical codes pass through unchanged (no blind pa_ stripping)", () => {
  assert.equal(canonicalizeOfficialAttributeCode("pa_marca"), "pa_marca");
  assert.equal(canonicalizeOfficialAttributeCode("pa_cor"), "pa_cor");
  assert.equal(canonicalizeOfficialAttributeCode("material"), "material");
  assert.equal(canonicalizeOfficialAttributeCode("Material do produto"), "Material do produto");
  assert.equal(canonicalizeOfficialAttributeCode("PA_MATERIAL"), "PA_MATERIAL"); // exact-match only, no case-folding
});

// ---------- Fase 8: local replay of the exact R6C scenarios ----------

test("R8 replay Caso A: official shows only Cor/Marca (R6C's real 0117 evidence) => comprimento/conexao/material remain PIM_ONLY, never become MATCH", () => {
  const off = official("0117", [
    { code: "pa_cor", name: "Cor", value: "Branco" },
    { code: "pa_marca", name: "Marca", value: "Krona" },
  ]);
  const candidate = buildPimCatalogCandidate("prod-0117", [
    record({ attributeSlug: "comprimento", canonicalValue: "6m", attributeValueId: "av-1" }),
    record({ attributeSlug: "conexao", canonicalValue: "Roscável", attributeValueId: "av-2" }),
    record({ attributeSlug: "material", canonicalValue: "PVC", attributeValueId: "av-3" }),
  ]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  const byCode = Object.fromEntries(result.differences.map((d) => [d.code, d.classification]));
  assert.equal(byCode.comprimento, "PIM_ONLY");
  assert.equal(byCode.conexao, "PIM_ONLY");
  assert.equal(byCode.material, "PIM_ONLY");
});

test("R8 replay Caso B: official pa_material=PVC, PIM material=PVC => MATCH (the fix's core proof)", () => {
  const off = official("SKU-B", [{ code: "pa_material", name: "Material", value: "PVC" }]);
  const candidate = buildPimCatalogCandidate("prod-B", [record({ attributeSlug: "material", canonicalValue: "PVC" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["MATCH"]);
});

test("R8 replay Caso C: official pa_material=Aço, PIM material=PVC => VALUE_DIFFERENCE (the fix does not turn a real disagreement into a false MATCH)", () => {
  const off = official("SKU-C", [{ code: "pa_material", name: "Material", value: "Aço" }]);
  const candidate = buildPimCatalogCandidate("prod-C", [record({ attributeSlug: "material", canonicalValue: "PVC" })]);
  const result = compareOfficialWithPimCandidate(off, candidate);
  assert.deepEqual(result.differences.map((d) => d.classification), ["VALUE_DIFFERENCE"]);
});
