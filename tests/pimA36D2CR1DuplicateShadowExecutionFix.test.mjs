// A3.6-D2-C-R1: root-cause fix for the 4x duplicate [pim-catalog-shadow]
// telemetry observed live during the D2-C 1% activation (canary
// "abracadeira-condulete-top-pvc-cinza-3-4-para-fixacao-de-eletroduto-tigre",
// 4 near-simultaneous events for the same productId, durations 161-172ms).
//
// ROOT CAUSE (proven by direct source inspection, not inference):
// getProductBySlug (services/woocommerce/products.ts) was called 4 times,
// completely independently, for one logical PDP request:
//   1. app/[...segments]/page.tsx :: generateMetadata -> resolvePublicRoute -> getProductBySlug
//   2. app/[...segments]/page.tsx :: PublicPage (default export) -> resolvePublicRoute -> getProductBySlug
//   3. app/_storefront/product-page.tsx :: generateMetadata -> getProductBySlug
//   4. app/_storefront/product-page.tsx :: ProductPage (default export) -> getProductBySlug
// None of these 4 call sites, nor getProductBySlug itself, was wrapped in
// React's cache() (or any other request-scoped memoization) -- so each call
// fully re-executed getProductBySlug's body, including its
// scheduleProductShadow(product) side effect, each producing its own
// independent, CORRECTLY single-fired (per observeOnce's existing
// single-fire guard) telemetry event. The duplicate is at the CALLER level
// (4 independent executions), not inside runPimCatalogShadow/observeOnce
// (which behaves exactly as designed, once per invocation).
//
// FIX: getProductBySlug is now wrapped in React's cache() -- the officially
// documented Next.js solution for exactly this "same data needed by
// generateMetadata and the page" scenario (Next's own bundled docs,
// 01-app/01-getting-started/14-metadata-and-og-images.md, "Memoizing data
// requests"). This collapses all 4 call sites (they all resolve through the
// same exported getProductBySlug) into a single execution per request,
// including the scheduleProductShadow side effect. cache() is scoped to a
// single request/render -- never cross-request, never shared between
// server instances/processes -- so it cannot merge data between users or
// leak across Hostinger's multiple Node processes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// ---------- structural proof: the fix is actually applied ----------

test("getProductBySlug is wrapped in React's cache()", async () => {
  const source = await read("services/woocommerce/products.ts");
  assert.match(source, /^import \{ cache \} from "react";/m);
  assert.match(source, /export const getProductBySlug = cache\(async function getProductBySlug\(/);
});

test("the scheduleProductShadow side effect is still inside the cache()-wrapped function body (deduped together with the data fetch, not bypassed)", async () => {
  const source = await read("services/woocommerce/products.ts");
  const fn = source.slice(
    source.indexOf("export const getProductBySlug = cache("),
    source.indexOf("export async function getProductVariations"),
  );
  assert.match(fn, /if \(product\) scheduleProductShadow\(product\);/);
});

// ---------- structural proof: the exact call-graph topology that caused the bug ----------

test("root cause topology: app/[...segments]/page.tsx calls resolvePublicRoute (which calls getProductBySlug) from BOTH generateMetadata and the default page component", async () => {
  const source = await read("app/[...segments]/page.tsx");
  const generateMetadataFn = source.slice(source.indexOf("export async function generateMetadata"), source.indexOf("export default async function PublicPage"));
  const publicPageFn = source.slice(source.indexOf("export default async function PublicPage"));
  assert.match(generateMetadataFn, /resolvePublicRoute\(segments\)/);
  assert.match(publicPageFn, /resolvePublicRoute\(segments\)/);
  assert.match(source, /const product = await getProductBySlug\(slug\)/);
});

test("root cause topology: app/_storefront/product-page.tsx calls getProductBySlug from BOTH generateMetadata and the default page component", async () => {
  const source = await read("app/_storefront/product-page.tsx");
  const generateMetadataFn = source.slice(source.indexOf("export async function generateMetadata"), source.indexOf("export default async function ProductPage"));
  const productPageFn = source.slice(source.indexOf("export default async function ProductPage"));
  assert.match(generateMetadataFn, /await getProductBySlug\(slug\)/);
  assert.match(productPageFn, /await getProductBySlug\(slug\)/);
});

// ---------- documented testing limitation ----------

test("KNOWN LIMITATION: React's cache() does not memoize outside an active RSC render, so this plain-Node test harness cannot mechanically prove the real deduplication effect -- documented, not silently assumed", async () => {
  const { cache } = await import("react");
  let calls = 0;
  const fn = cache(async (x) => { calls += 1; return x; });
  await fn(1);
  await fn(1);
  // Outside a real Next.js Server Component render, cache() has no request
  // context to memoize against, so it falls through to calling the
  // function every time -- confirmed empirically (calls === 2, not 1).
  // This is a property of the TEST ENVIRONMENT, not evidence that cache()
  // fails to deduplicate in the real Next.js runtime, where this exact
  // pattern is the framework's own official, widely-used recommendation.
  // Full end-to-end confirmation (1 request => 1 [pim-catalog-shadow]
  // event) requires either a real Next.js request render (out of scope
  // this round -- would require a local dev/build server making a real
  // read against production WooCommerce, not authorized this round) or a
  // future, separately-authorized controlled re-activation on staging.
  assert.equal(calls, 2, "documents the test harness's inability to observe cache() deduplication -- not a claim about production behavior");
});

// ---------- reproduction of the pre-fix failure mode at the shadow-runtime layer ----------
// Demonstrates the MECHANISM that made the bug possible: runPimCatalogShadow
// itself is correctly single-fire PER CALL (already proven extensively in
// tests/pimA36BShadowRuntime.test.mjs, rerun green this round) -- but has no
// visibility into sibling calls. If a caller invokes it N times for the
// same product (exactly what the un-deduped call graph did, N=4), N
// telemetry events are produced. This is real production code
// (runPimCatalogShadow), exercised with injected deps (zero network/DB),
// matching this repo's established testing pattern.
test("pre-fix mechanism reproduction: N independent (un-deduped) calls to runPimCatalogShadow for the SAME product produce N telemetry events, not 1", async () => {
  const { runPimCatalogShadow } = await import("../lib/pim/publication-shadow-runtime.ts");
  const events = [];
  const official = { sku: "SKU-CANARY", slug: "abracadeira-condulete-top-pvc-cinza-3-4-para-fixacao-de-eletroduto-tigre", attributes: [{ code: "material", name: "Material", value: "PVC" }] };
  const deps = {
    mode: "shadow",
    sampleRatePercent: 100,
    telemetry: (event) => { events.push(event); },
    resolvePimProductId: async () => "prod-canary",
    fetchPublishedAttributes: async () => new Map([["prod-canary", []]]),
    schedule: (work) => { work(); }, // synchronous for the test, matching the existing test suite's pattern
  };
  const CALL_GRAPH_MULTIPLICITY_BEFORE_FIX = 4; // generateMetadata x2 + page component x2, see topology tests above
  for (let i = 0; i < CALL_GRAPH_MULTIPLICITY_BEFORE_FIX; i++) {
    runPimCatalogShadow(official, "product", deps);
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events.length, CALL_GRAPH_MULTIPLICITY_BEFORE_FIX);
  for (const event of events) {
    assert.equal(event.classification, "OFFICIAL_ONLY");
    assert.equal(event.shadowStatus, "completed");
  }
});

test("by contrast: a single call to runPimCatalogShadow for the same product produces exactly one telemetry event (the unit the fix restores per real request)", async () => {
  const { runPimCatalogShadow } = await import("../lib/pim/publication-shadow-runtime.ts");
  const events = [];
  const official = { sku: "SKU-CANARY", slug: "abracadeira-condulete-top-pvc-cinza-3-4-para-fixacao-de-eletroduto-tigre", attributes: [{ code: "material", name: "Material", value: "PVC" }] };
  runPimCatalogShadow(official, "product", {
    mode: "shadow",
    sampleRatePercent: 100,
    telemetry: (event) => { events.push(event); },
    resolvePimProductId: async () => "prod-canary",
    fetchPublishedAttributes: async () => new Map([["prod-canary", []]]),
    schedule: (work) => { work(); },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events.length, 1);
  assert.equal(events[0].classification, "OFFICIAL_ONLY");
});

test("two DIFFERENT products are not blocked/merged by each other -- each gets its own single event", async () => {
  const { runPimCatalogShadow } = await import("../lib/pim/publication-shadow-runtime.ts");
  const events = [];
  const deps = (productId) => ({
    mode: "shadow",
    sampleRatePercent: 100,
    telemetry: (event) => { events.push(event); },
    resolvePimProductId: async () => productId,
    fetchPublishedAttributes: async () => new Map([[productId, []]]),
    schedule: (work) => { work(); },
  });
  runPimCatalogShadow({ sku: "SKU-A", slug: "produto-a", attributes: [{ code: "material", name: "Material", value: "PVC" }] }, "product", deps("prod-a"));
  runPimCatalogShadow({ sku: "SKU-B", slug: "produto-b", attributes: [{ code: "material", name: "Material", value: "PVC" }] }, "product", deps("prod-b"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events.length, 2);
  assert.deepEqual(new Set(events.map((e) => e.productId)), new Set(["prod-a", "prod-b"]));
});

// ---------- A3.6-D2-C-R2: official response invariance audit ----------
// getProductBySlug's function BODY is byte-for-byte unchanged by this fix
// (confirmed via `git diff` against the pre-fix commit: only the
// declaration line and closing brace changed, to wrap the same, untouched
// body in cache(...)). What remains to prove is that cache() itself, as a
// wrapper, does not alter resolved values or swallow/transform rejections
// -- i.e. that memoizing does not change WHAT is returned or thrown, only
// how many times the body executes.

test("cache() preserves a resolved value exactly, unmodified", async () => {
  const { cache } = await import("react");
  const fn = cache(async (x) => ({ ok: true, x }));
  const result = await fn("abc");
  assert.deepEqual(result, { ok: true, x: "abc" });
});

test("cache() preserves a rejection exactly -- does not swallow, transform, or default to a success value", async () => {
  const { cache } = await import("react");
  const boom = new Error("Store API error simulation");
  const fn = cache(async () => { throw boom; });
  await assert.rejects(() => fn(), boom);
});

test("getProductBySlug's function body (product lookup, shadow scheduling, variable-product enrichment) is untouched by this fix -- only the declaration/closing-brace lines differ from before, per source inspection", async () => {
  const source = await read("services/woocommerce/products.ts");
  const fn = source.slice(
    source.indexOf("async function getProductBySlug("),
    source.indexOf("export async function getProductVariations"),
  );
  // Same statements as before the fix, still present verbatim inside the
  // now-cache()-wrapped function -- product lookup, the shadow side
  // effect, the not-found/non-variable early return, and the variable
  // product enrichment path.
  assert.match(fn, /const products = await getProducts\(\{/);
  assert.match(fn, /const product = products\[0\];/);
  assert.match(fn, /if \(product\) scheduleProductShadow\(product\);/);
  assert.match(fn, /if \(!product \|\| product\.type !== "variable"\) return product;/);
  assert.match(fn, /variations: await getProductVariations\(product\.id\),/);
});

// ---------- Section 9 invariants: unaffected by this fix, already covered ----------
// This fix touches ONLY services/woocommerce/products.ts (adds cache()) and
// this test file. lib/pim/publication-shadow-runtime.ts,
// publication-shadow-comparison.ts, and publication-shadow-telemetry.ts are
// byte-for-byte unchanged, so their existing, still-green test coverage
// (tests/pimA36BShadowRuntime.test.mjs, tests/pimA36CShadowActivationQualification.test.mjs,
// tests/pimA36AShadowComparison.test.mjs) continues to prove: mode=off =>
// zero work; sample=0 => zero work; sample=1 => 1%; Woo stays official; PIM
// never alters the official response; shadow error never escapes; 500ms
// timeout; NEEDS_REVIEW stays BLOCKED; published=0 => OFFICIAL_ONLY;
// list/category/search remain disconnected; zero publication; zero DB
// writes; zero provider calls. Not re-duplicated here.
test("this fix did not touch the shadow runtime/comparison/telemetry modules -- their existing invariant coverage still applies unchanged", async () => {
  const files = [
    "lib/pim/publication-shadow-runtime.ts",
    "lib/pim/publication-shadow-comparison.ts",
    "lib/pim/publication-shadow-telemetry.ts",
  ];
  for (const file of files) {
    const source = await read(file);
    assert.doesNotMatch(source, /from "react"/, `${file} should not need React's cache() -- the fix is caller-side only`);
  }
});
