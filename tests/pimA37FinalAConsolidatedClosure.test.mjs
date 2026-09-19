import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { roleHasPermission } from "../lib/admin/permissions.ts";
import { evaluatePublicationEligibility, evaluatePublicationEligibilityBatch } from "../lib/pim/publication-eligibility.ts";
import { resolveStorefrontPathForProduct, revalidateStorefrontProductPaths } from "../lib/pim/storefront-cache-invalidation.ts";
import { resolveFichaTecnicaSpecifications } from "../services/catalog/productFichaTecnica.ts";
import { computeProductCorrelationTag } from "../lib/pim/publication-ficha-tecnica-diagnostics.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// A3.7-FINAL-A: consolidated coverage for the workstreams closed this round
// (RBAC, human-approval-before-publication eligibility, eligibility
// round-trip batching, storefront cache-invalidation contract, timeout
// naming, correlation-tag continuity). Section-by-section tests already
// covering a workstream in detail elsewhere (D8's correlation-tag suite,
// the pre-existing publishBatch/reviewPimAttribute atomicity tests) are not
// duplicated here -- this file targets what specifically changed or was
// newly introduced this round.

// ---------- Workstream A: RBAC ----------

test("RBAC: PIM_APPROVER can now review attributes; unrelated permissions unaffected", () => {
  assert.equal(roleHasPermission("PIM_APPROVER", "pim.attribute.review"), true);
  assert.equal(roleHasPermission("PIM_APPROVER", "pim.workflow.approve"), true);
  assert.equal(roleHasPermission("PIM_APPROVER", "pim.workflow.reject"), true);
  assert.equal(roleHasPermission("PIM_APPROVER", "pim.conflict.resolve"), true);
  // Least-privilege: nothing else was granted alongside pim.attribute.review.
  assert.equal(roleHasPermission("PIM_APPROVER", "pim.draft.edit"), false);
  assert.equal(roleHasPermission("PIM_APPROVER", "pim.workflow.submit"), false);
  assert.equal(roleHasPermission("PIM_APPROVER", "pim.suggestion.review"), false);
});

// ---------- Workstream B: human approval required for publication ----------

function fakeDb(rows) {
  return { execute: async () => rows };
}

const baseRow = { sku: "0117", attributeCode: "comprimento", displayValue: "6m", description: null, identityMatches: true, openConflictSameAttribute: false };
const identity = { productId: "11111111-1111-4111-8111-111111111111", attributeId: "22222222-2222-4222-8222-222222222222", attributeValueId: "33333333-3333-4333-8333-333333333333" };

test("eligibility: reviewStatus 'approved' is eligible (no NOT_REVIEWED, no other review-related reason)", async () => {
  const result = await evaluatePublicationEligibility(fakeDb([{ ...baseRow, reviewStatus: "approved" }]), identity);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reasonCodes, []);
});

test("eligibility: NO review row at all (reviewStatus null) now blocks with NOT_REVIEWED -- the core Workstream B policy reversal", async () => {
  const result = await evaluatePublicationEligibility(fakeDb([{ ...baseRow, reviewStatus: null }]), identity);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasonCodes, ["NOT_REVIEWED"]);
});

test("eligibility: reviewStatus 'rejected' blocks with HUMAN_REVIEW_REJECTED (unchanged pre-existing gate)", async () => {
  const result = await evaluatePublicationEligibility(fakeDb([{ ...baseRow, reviewStatus: "rejected" }]), identity);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasonCodes, ["HUMAN_REVIEW_REJECTED"]);
});

test("eligibility: reviewStatus 'needs_review' blocks with NEEDS_REVIEW (unchanged pre-existing gate)", async () => {
  const result = await evaluatePublicationEligibility(fakeDb([{ ...baseRow, reviewStatus: "needs_review" }]), identity);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasonCodes, ["NEEDS_REVIEW"]);
});

test("eligibility: NOT_REVIEWED can combine with other independent reasons (e.g. an open conflict) without deduping them away", async () => {
  const result = await evaluatePublicationEligibility(fakeDb([{ ...baseRow, reviewStatus: null, openConflictSameAttribute: true }]), identity);
  assert.equal(result.eligible, false);
  assert.deepEqual([...result.reasonCodes].sort(), ["NOT_REVIEWED", "OPEN_CONFLICT_SAME_ATTRIBUTE"]);
});

// ---------- Workstream D: eligibility batching (round-trip reduction) ----------

test("evaluatePublicationEligibilityBatch issues exactly ONE db.execute call regardless of identity count", async () => {
  let calls = 0;
  const db = { execute: async () => { calls++; return [0, 1, 2].map((ord) => ({ ...baseRow, reviewStatus: "approved", ord })); } };
  const identities = [identity, { ...identity, attributeId: "44444444-4444-4444-8444-444444444444" }, { ...identity, attributeId: "55555555-5555-4555-8555-555555555555" }];
  const results = await evaluatePublicationEligibilityBatch(db, identities);
  assert.equal(calls, 1, "batching must not fall back to one round trip per identity");
  assert.equal(results.size, 3);
});

test("evaluatePublicationEligibilityBatch returns an empty Map without any db call for an empty identity list", async () => {
  let calls = 0;
  const db = { execute: async () => { calls++; return []; } };
  const results = await evaluatePublicationEligibilityBatch(db, []);
  assert.equal(calls, 0);
  assert.equal(results.size, 0);
});

test("evaluatePublicationEligibilityBatch applies the SAME gates as the single-identity function (parity, including NOT_REVIEWED)", async () => {
  const db = { execute: async () => [{ ...baseRow, reviewStatus: null, ord: 0 }] };
  const results = await evaluatePublicationEligibilityBatch(db, [identity]);
  const result = results.get(`${identity.productId}:${identity.attributeId}:${identity.attributeValueId}`);
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasonCodes, ["NOT_REVIEWED"]);
});

test("evaluatePublicationEligibilityBatch: an identity absent from the returned rows (e.g. no variant / product not found) maps to ASSOCIATION_NOT_FOUND, never silently dropped from the Map", async () => {
  const db = { execute: async () => [] };
  const results = await evaluatePublicationEligibilityBatch(db, [identity]);
  const result = results.get(`${identity.productId}:${identity.attributeId}:${identity.attributeValueId}`);
  assert.ok(result, "every requested identity must have a Map entry even when its row is missing");
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasonCodes, ["ASSOCIATION_NOT_FOUND"]);
});

// ---------- Workstream B/E: storefront fails closed when a published value loses eligibility ----------

function fichaTecnicaBaseDeps(overrides = {}) {
  return {
    mode: "canary",
    rawMode: "canary",
    isSafeToRun: () => true,
    resolvePimProductId: async () => "pim-prod-1",
    getActiveCanaryMembership: async () => [{ productId: "pim-prod-1", attributeCode: "material", batchId: "batch-1" }],
    getPublishedAttributesForProduct: async () => [{ productId: "pim-prod-1", attributeId: "attr-1", attributeSlug: "material", attributeName: "Material", attributeValueId: "val-1", canonicalValue: "PVC", publicationState: "published", batchId: "batch-1", publishedAt: new Date() }],
    diagnosticsEnabled: false,
    ...overrides,
  };
}

function officialProduct(overrides = {}) {
  // Same shape as the D8 observability suite's product() fixture -- the
  // full field set buildFichaTecnicaSpecifications()'s Woo-side mapping
  // needs to actually classify PIM_ONLY/MATCH/VALUE_DIFFERENCE candidates,
  // not just the few fields the diagnostics layer itself reads.
  return {
    id: 1, slug: "produto-teste", type: "simple", name: "Produto Teste", permalink: "https://x/produto-teste",
    sku: "SKU-1", shortDescription: "", description: "", price: 10, currencyCode: "BRL", currencySymbol: "R$",
    currencyMinorUnit: 2, images: [], categories: [], brands: [], available: true, stockStatus: "instock",
    averageRating: 0, reviewCount: 0, featured: false, onSale: false, attributes: [], variations: [],
    ...overrides,
  };
}

test("storefront: a published attribute that is currently NOT_REVIEWED/rejected/needs_review is excluded from the Ficha Tecnica on the very next render -- fail-closed before any physical unpublish", async () => {
  const deps = fichaTecnicaBaseDeps({
    evaluatePublicationEligibilityBatch: async () => new Map([["pim-prod-1:attr-1:val-1", { eligible: false, reasonCodes: ["NOT_REVIEWED"], sku: "0117", attributeCode: "material", value: "PVC" }]]),
  });
  const result = await resolveFichaTecnicaSpecifications(officialProduct(), deps);
  assert.equal(result, undefined, "no PIM specification may reach the response once eligibility is revoked, regardless of the batch's own published/unpublished state");
});

test("storefront: the SAME published attribute stays visible while it remains eligible (control case for the test above)", async () => {
  const deps = fichaTecnicaBaseDeps({
    evaluatePublicationEligibilityBatch: async () => new Map([["pim-prod-1:attr-1:val-1", { eligible: true, reasonCodes: [], sku: "0117", attributeCode: "material", value: "PVC" }]]),
  });
  const result = await resolveFichaTecnicaSpecifications(officialProduct(), deps);
  assert.ok(Array.isArray(result) && result.length > 0);
});

// ---------- Workstream E: storefront cache invalidation contract ----------

// resolveStorefrontPathForProduct calls the REAL getDatabase() internally
// (a thin, single-query read, consistent with every other
// publication-read-model.ts function) -- it has no offline-safe unit test
// of its own here for that reason; it is exercised indirectly through
// revalidateStorefrontProductPaths below, which IS the actual integration
// surface publishBatch/unpublishBatch/reviewPimAttribute/
// decidePimConflictAttribute use, and through source-shape assertions.

test("revalidateStorefrontProductPaths: calls the injected revalidate function once per UNIQUE product id, never once per duplicate", async () => {
  const calls = [];
  const revalidate = (path) => { calls.push(path); };
  let resolveCalls = 0;
  const resolvePath = async (productId) => { resolveCalls++; return `/produto-${productId}`; };
  // Two duplicate ids in the input must resolve/revalidate exactly ONCE.
  await revalidateStorefrontProductPaths(["dup-1", "dup-1"], revalidate, resolvePath);
  assert.equal(resolveCalls, 1);
  assert.deepEqual(calls, ["/produto-dup-1"]);
});

test("revalidateStorefrontProductPaths: calls revalidate once per DISTINCT resolved path when ids differ", async () => {
  const calls = [];
  const resolvePath = async (productId) => `/produto-${productId}`;
  await revalidateStorefrontProductPaths(["a", "b"], (path) => { calls.push(path); }, resolvePath);
  assert.deepEqual(calls.sort(), ["/produto-a", "/produto-b"]);
});

test("revalidateStorefrontProductPaths: a product id that resolves to null (no slug / not found) is never passed to revalidate", async () => {
  const calls = [];
  await revalidateStorefrontProductPaths(["missing"], (path) => { calls.push(path); }, async () => null);
  assert.deepEqual(calls, []);
});

test("revalidateStorefrontProductPaths: never throws even when the path resolver itself throws (e.g. no DB context)", async () => {
  await assert.doesNotReject(revalidateStorefrontProductPaths(["some-id"], () => { throw new Error("must never be called"); }, async () => { throw new Error("db unreachable"); }));
});

test("revalidateStorefrontProductPaths: never throws even when the injected revalidate function itself throws (e.g. no Next.js request context)", async () => {
  const throwingRevalidate = () => { throw new Error("boom"); };
  await assert.doesNotReject(revalidateStorefrontProductPaths(["some-id"], throwingRevalidate, async () => "/some-path"));
});

test("revalidateStorefrontProductPaths: never throws for an empty id list, and never calls either dependency", async () => {
  await assert.doesNotReject(revalidateStorefrontProductPaths([], () => { throw new Error("must never be called"); }, async () => { throw new Error("must never be called"); }));
});

test("storefront-cache-invalidation.ts never writes to the database (read-only slug lookup, best-effort side effect only)", async () => {
  const source = await read("lib/pim/storefront-cache-invalidation.ts");
  assert.doesNotMatch(source, /insert into|update public\.|delete from/i);
});

test("storefront-cache-invalidation.ts's revalidate call is dynamically imported, never a static top-level next/cache import (keeps disposable Node scripts importing publication-service.ts from needing Next's runtime at module load time)", async () => {
  const source = await read("lib/pim/storefront-cache-invalidation.ts");
  assert.doesNotMatch(source, /^import.*from "next\/cache"/m);
  assert.match(source, /await import\("next\/cache"\)/);
});

// ---------- Workstream E: cache invalidation is wired into every state-changing PIM entry point ----------

test("publishBatch and unpublishBatch both trigger storefront revalidation after their transaction commits", async () => {
  const source = await read("lib/pim/publication-service.ts");
  assert.match(source, /import \{ revalidateStorefrontProductPaths \} from "\.\/storefront-cache-invalidation"/);
  const publishFn = source.slice(source.indexOf("export async function publishBatch"), source.indexOf("export async function unpublishBatch"));
  assert.match(publishFn, /revalidateStorefrontProductPaths\(input\.members\.map/);
  const unpublishFn = source.slice(source.indexOf("export async function unpublishBatch"), source.indexOf("export async function getPublicationState"));
  assert.match(unpublishFn, /revalidateStorefrontProductPaths\(affectedProductIds\)/);
});

test("reviewPimAttribute triggers storefront revalidation after its transaction commits", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  assert.match(source, /import \{ revalidateStorefrontProductPaths \} from "@\/lib\/pim\/storefront-cache-invalidation"/);
  assert.match(source, /revalidateStorefrontProductPaths\(\[result\.productId\]\)/);
});

test("decidePimConflictAttribute triggers storefront revalidation after its transaction commits", async () => {
  const source = await read("lib/pim/workflow.ts");
  assert.match(source, /import \{revalidateStorefrontProductPaths\} from "@\/lib\/pim\/storefront-cache-invalidation"/);
  const fn = source.slice(source.indexOf("export async function decidePimConflictAttribute"));
  assert.match(fn, /revalidateStorefrontProductPaths\(\[result\.productId\]\)/);
});

// ---------- Workstream E: cache-invalidation wiring never crosses into
// reviewPimAttribute directly writing/reading publication state ----------

test("reviewPimAttribute still never touches suggestions, editorial profile, conflicts, or publication tables (Workstream E wiring is cache-only, not a new data coupling)", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  assert.doesNotMatch(source, /into pim_suggestions|into pim_product_profiles|into pim_conflicts|update pim_conflicts|from pim_suggestions|from pim_product_profiles|decidePimSuggestion|transitionPimEditorial/);
  assert.doesNotMatch(source, /publish|published_at/i);
  assert.doesNotMatch(source, /\bproducts\b|\bproduct_variants\b|\bprices\b|\binventory_levels\b/);
});

// ---------- Section 9: timeout naming ----------

test("productFichaTecnica.ts's timeout constant is now semantically named and separate from shadow's, value UNCHANGED at 300ms", async () => {
  const source = await read("services/catalog/productFichaTecnica.ts");
  assert.match(source, /const CANARY_STOREFRONT_TIMEOUT_MS = 300;/);
  assert.doesNotMatch(source, /const DEFAULT_TIMEOUT_MS/);
});

test("publication-shadow-runtime.ts's own timeout constant (500ms) is untouched -- this round only renamed the storefront/canary one", async () => {
  const source = await read("lib/pim/publication-shadow-runtime.ts");
  assert.match(source, /const DEFAULT_TIMEOUT_MS = 500;/);
});

// ---------- Workstream C: correlation tag continuity (no regression from this round's other changes) ----------

test("computeProductCorrelationTag remains importable and deterministic after this round's changes", () => {
  const a = computeProductCorrelationTag("11111111-1111-4111-8111-111111111111");
  const b = computeProductCorrelationTag("11111111-1111-4111-8111-111111111111");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{12}$/);
});
