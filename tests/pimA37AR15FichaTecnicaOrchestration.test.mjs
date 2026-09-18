// A3.7-A-R15: orchestration tests for services/catalog/productFichaTecnica.ts.
// Dependency-injected exactly like lib/pim/publication-shadow-runtime.ts's
// own test pattern (tests/pimA36BShadowRuntime.test.mjs) -- zero real DB,
// zero network. The pure merge matrix itself is tested separately in
// tests/pimA37AR15FichaTecnicaMergeMatrix.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveFichaTecnicaSpecifications } from "../services/catalog/productFichaTecnica.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function product(overrides = {}) {
  return {
    id: 1, slug: "produto-teste", type: "simple", name: "Produto Teste", permalink: "https://x/produto-teste",
    sku: "SKU-1", shortDescription: "", description: "", price: 10, currencyCode: "BRL", currencySymbol: "R$",
    currencyMinorUnit: 2, images: [], categories: [], brands: [], available: true, stockStatus: "instock",
    averageRating: 0, reviewCount: 0, featured: false, onSale: false, attributes: [], variations: [],
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    productId: "pim-prod-1", attributeId: "attr-1", attributeSlug: "material", attributeName: "Material",
    attributeValueId: "av-1", canonicalValue: "PVC", publicationState: "published", batchId: "batch-1", publishedAt: null,
    ...overrides,
  };
}

function baseDeps(overrides = {}) {
  return {
    mode: "canary",
    timeoutMs: 200,
    isSafeToRun: () => true,
    resolvePimProductId: async () => "pim-prod-1",
    getActiveCanaryMembership: async () => [{ productId: "pim-prod-1", attributeCode: "material", batchId: "batch-1" }],
    getPublishedAttributesForProduct: async () => [record()],
    evaluatePublicationEligibilityBatch: async (_db, identities) => new Map(identities.map((id) => [`${id.productId}:${id.attributeId}:${id.attributeValueId}`, { eligible: true, reasonCodes: [], sku: "SKU-1", attributeCode: "material", value: "PVC" }])),
    ...overrides,
  };
}

// ---------- mode gating ----------

test("mode=off: returns undefined, zero dependency calls (not even the safety check)", async () => {
  let calls = 0;
  const deps = baseDeps({ mode: "off", isSafeToRun: () => { calls++; return true; }, resolvePimProductId: async () => { calls++; return "x"; } });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  assert.equal(calls, 0);
});

test("mode=shadow: returns undefined, zero dependency calls -- identical short-circuit to off", async () => {
  let calls = 0;
  const deps = baseDeps({ mode: "shadow", isSafeToRun: () => { calls++; return true; } });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  assert.equal(calls, 0);
});

test("unknown/invalid mode string: fails closed to the same behavior as off", async () => {
  const deps = baseDeps({ mode: "bogus-mode" });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
});

// ---------- canary gating ----------

test("mode=canary but isSafeToRun()=false (staging-binding guard fails): returns undefined before any further DB access", async () => {
  let membershipCalled = false;
  const deps = baseDeps({ isSafeToRun: () => false, getActiveCanaryMembership: async () => { membershipCalled = true; return []; } });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  assert.equal(membershipCalled, false);
});

test("no PIM product resolves for this slug: returns undefined", async () => {
  const deps = baseDeps({ resolvePimProductId: async () => null });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
});

test("canary allowlist: zero active canary membership rows -> returns undefined (not a canary product at all)", async () => {
  let publishedCalled = false;
  const deps = baseDeps({ getActiveCanaryMembership: async () => [], getPublishedAttributesForProduct: async () => { publishedCalled = true; return []; } });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  assert.equal(publishedCalled, false, "must short-circuit on empty membership before even reading published attributes");
});

test("non-canary isolation: published attribute codes that are NOT in the canary membership set are excluded", async () => {
  const deps = baseDeps({
    getActiveCanaryMembership: async () => [{ productId: "pim-prod-1", attributeCode: "material", batchId: "batch-1" }],
    getPublishedAttributesForProduct: async () => [record({ attributeSlug: "conexao", attributeName: "Conexão", canonicalValue: "Roscável" })], // published under a DIFFERENT (non-canary-member) code
  });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
});

test("published-only / active-batch-only: relies on getPublishedAttributesForProduct's own isPublicationExposable gate -- if it returns nothing, this orchestrator adds nothing", async () => {
  const deps = baseDeps({ getPublishedAttributesForProduct: async () => [] });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
});

// ---------- review-after-publication (A3.7-A-R14-R5 residual risk) ----------

test("review-after-publication: a canary-published attribute that fails a FRESH eligibility re-check is excluded even though it is state='published'", async () => {
  const deps = baseDeps({
    evaluatePublicationEligibilityBatch: async () => new Map([["pim-prod-1:attr-1:av-1", { eligible: false, reasonCodes: ["NEEDS_REVIEW"], sku: "SKU-1", attributeCode: "material", value: "PVC" }]]),
  });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined, "a NEEDS_REVIEW re-check result must block exposure even though the row is historically published");
});

test("review-after-publication: with two canary attributes, only the one that STILL passes eligibility is exposed", async () => {
  const deps = baseDeps({
    getActiveCanaryMembership: async () => [
      { productId: "pim-prod-1", attributeCode: "material", batchId: "batch-1" },
      { productId: "pim-prod-1", attributeCode: "comprimento", batchId: "batch-1" },
    ],
    getPublishedAttributesForProduct: async () => [
      record({ attributeSlug: "material", attributeId: "attr-mat", attributeValueId: "av-mat", canonicalValue: "PVC" }),
      record({ attributeSlug: "comprimento", attributeName: "Comprimento", attributeId: "attr-comp", attributeValueId: "av-comp", canonicalValue: "6m" }),
    ],
    evaluatePublicationEligibilityBatch: async () => new Map([
      ["pim-prod-1:attr-mat:av-mat", { eligible: true, reasonCodes: [], sku: "SKU-1", attributeCode: "material", value: "PVC" }],
      ["pim-prod-1:attr-comp:av-comp", { eligible: false, reasonCodes: ["HUMAN_REVIEW_REJECTED"], sku: "SKU-1", attributeCode: "comprimento", value: "6m" }],
    ]),
  });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.ok(result);
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "Material");
});

// ---------- happy path ----------

test("happy path: canary + published + eligible -> returns the merged specifications (PIM_ONLY additive, real merge function used)", async () => {
  const deps = baseDeps();
  const result = await resolveFichaTecnicaSpecifications(product({ attributes: [{ id: 1, name: "Cor", taxonomy: "pa_cor", hasVariations: false, terms: [{ id: 1, name: "Branco", slug: "branco" }], options: [{ value: "branco", label: "Branco" }] }] }), deps);
  assert.deepEqual(result, [
    { label: "Cor", value: "Branco" },
    { label: "Material", value: "PVC" },
  ]);
});

// ---------- fail-closed: timeout and errors ----------

test("timeout: a slow dependency causes resolveFichaTecnicaSpecifications to fail closed to undefined, never hang the caller", async () => {
  const deps = baseDeps({
    timeoutMs: 20,
    resolvePimProductId: () => new Promise((resolve) => setTimeout(() => resolve("pim-prod-1"), 200)),
  });
  const start = Date.now();
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  const elapsed = Date.now() - start;
  assert.equal(result, undefined);
  assert.ok(elapsed < 150, `expected to fail closed near the 20ms timeout, took ${elapsed}ms`);
});

test("any dependency throwing synchronously or rejecting: falls back to undefined, never propagates", async () => {
  const deps = baseDeps({ getActiveCanaryMembership: async () => { throw new Error("simulated DB error"); } });
  await assert.doesNotReject(async () => {
    const result = await resolveFichaTecnicaSpecifications(product(), deps);
    assert.equal(result, undefined);
  });
});

// ---------- query shape ----------

test("query shape: exactly one call each to resolvePimProductId / getActiveCanaryMembership / getPublishedAttributesForProduct, and exactly one BATCHED eligibility call (not one per attribute)", async () => {
  const calls = { resolve: 0, membership: 0, published: 0, eligibilityBatches: 0 };
  const deps = baseDeps({
    resolvePimProductId: async () => { calls.resolve++; return "pim-prod-1"; },
    getActiveCanaryMembership: async () => { calls.membership++; return [
      { productId: "pim-prod-1", attributeCode: "material", batchId: "batch-1" },
      { productId: "pim-prod-1", attributeCode: "comprimento", batchId: "batch-1" },
    ]; },
    getPublishedAttributesForProduct: async () => { calls.published++; return [
      record({ attributeSlug: "material", attributeId: "attr-mat", attributeValueId: "av-mat" }),
      record({ attributeSlug: "comprimento", attributeName: "Comprimento", attributeId: "attr-comp", attributeValueId: "av-comp", canonicalValue: "6m" }),
    ]; },
    evaluatePublicationEligibilityBatch: async (_db, identities) => {
      calls.eligibilityBatches++;
      return new Map(identities.map((id) => [`${id.productId}:${id.attributeId}:${id.attributeValueId}`, { eligible: true, reasonCodes: [], sku: "SKU-1", attributeCode: "x", value: "y" }]));
    },
  });
  await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(calls.resolve, 1);
  assert.equal(calls.membership, 1);
  assert.equal(calls.published, 1);
  assert.equal(calls.eligibilityBatches, 1, "eligibility must be checked via ONE batched call, not one query per attribute");
});

// ---------- structural: main-PDP-only, no other surface, server-only, no writes ----------

test("structural: resolveFichaTecnicaSpecifications has exactly one productive call site repo-wide, and it is app/_storefront/product-page.tsx", async () => {
  const { execSync } = await import("node:child_process");
  const output = execSync('git grep -n "resolveFichaTecnicaSpecifications(" -- "*.ts" "*.tsx"', { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  const lines = output.trim().split("\n").filter(Boolean);
  const calls = lines.filter((line) => !line.includes("services/catalog/productFichaTecnica.ts:") || !line.includes("export async function resolveFichaTecnicaSpecifications"));
  assert.equal(calls.length, 1, `expected exactly 1 call site, found: ${JSON.stringify(calls)}`);
  assert.ok(calls[0].startsWith("app/_storefront/product-page.tsx:"), `the one call site must be product-page.tsx, got: ${calls[0]}`);
});

test("structural: productNavigation.ts (family/category navigation) never references the Ficha Técnica canary path", async () => {
  const source = await read("services/woocommerce/productNavigation.ts");
  assert.doesNotMatch(source, /productFichaTecnica|resolveFichaTecnicaSpecifications|publication-ficha-tecnica/);
});

test("structural: no listing/search/category/carousel/recommendation component imports the Ficha Técnica canary path", async () => {
  const { execSync } = await import("node:child_process");
  let matches = [];
  try {
    const output = execSync('git grep -l "productFichaTecnica\\|resolveFichaTecnicaSpecifications" -- "app" "components"', { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    matches = output.trim().split("\n").filter(Boolean);
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  assert.deepEqual(matches, ["app/_storefront/product-page.tsx"], "only the main PDP page may reference the Ficha Técnica canary path");
});

test("server-only: services/catalog/productFichaTecnica.ts is marked server-only", async () => {
  const source = await read("services/catalog/productFichaTecnica.ts");
  assert.match(source, /^import "server-only";/m);
});

test("server-only boundary: components/Product/ProductDetails.tsx (a Client Component) never imports any lib/pim or productFichaTecnica module -- only plain, already-resolved data crosses that boundary", async () => {
  const source = await read("components/Product/ProductDetails.tsx");
  assert.match(source, /^"use client";/);
  assert.doesNotMatch(source, /lib\/pim|productFichaTecnica/);
});

test("no DB writes: neither the orchestrator nor the pure merge function contains any write statement", async () => {
  const orchestrator = await read("services/catalog/productFichaTecnica.ts");
  const merge = await read("lib/pim/publication-ficha-tecnica.ts");
  for (const source of [orchestrator, merge]) {
    assert.doesNotMatch(source, /\binsert\s+into\b/i);
    assert.doesNotMatch(source, /\bupdate\s+public\./i);
    assert.doesNotMatch(source, /\bdelete\s+from\b/i);
  }
});

test("no Woo write: the orchestrator never calls a WooCommerce write/mutation function (only mapWooProductToCatalog, a pure read-side mapper, is used)", async () => {
  const source = await read("services/catalog/productFichaTecnica.ts");
  assert.doesNotMatch(source, /storeApiPost|storeApiPut|storeApiDelete|WOOCOMMERCE_CONSUMER_SECRET/);
});

test("pure merge function file does not import 'server-only' -- consistent with its sibling lib/pim/publication-shadow-comparison.ts, which is also I/O-free and does not need the marker", async () => {
  const source = await read("lib/pim/publication-ficha-tecnica.ts");
  assert.doesNotMatch(source, /"server-only"/);
});
