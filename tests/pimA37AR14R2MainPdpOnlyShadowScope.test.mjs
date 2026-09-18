// A3.7-A-R14-R2: fixes the root cause proven in A3.7-A-R14-R1 -- one
// logical PDP access to SKU 0117 produced 3 [pim-catalog-shadow] events for
// 3 different products, because scheduleProductShadow(product) lived
// inside the SHARED getProductBySlug(), which is also called for
// incidental, non-main-PDP lookups (services/woocommerce/productNavigation.ts's
// family-navigation previous/next siblings). The fix moves the single
// scheduleProductShadow call out of that shared primitive and into the one
// call site that actually knows a product is the route's main subject
// (app/_storefront/product-page.tsx).
//
// Follows this repo's own established pattern for this exact bug class
// (tests/pimA36D2CR1DuplicateShadowExecutionFix.test.mjs): source-level
// structural proof for the call-graph topology (getProductBySlug does real
// network I/O, so it is not unit-tested by mocking it here), plus
// runtime-level unit tests (injected deps, zero network/DB) for the shadow
// orchestrator's own behavior.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// ---------- TEST 1: getProductBySlug is data-retrieval only ----------

test("TEST 1: getProductBySlug's body contains no reference to scheduleProductShadow at all", async () => {
  const source = await read("services/woocommerce/products.ts");
  const fn = source.slice(
    source.indexOf("export const getProductBySlug = cache("),
    source.indexOf("export async function getProductVariations"),
  );
  assert.doesNotMatch(fn, /scheduleProductShadow/);
  // and the now-dead import was removed, not just unused
  assert.doesNotMatch(source, /import\s*\{\s*scheduleProductShadow\s*\}/);
});

// ---------- TEST 2: main PDP boundary schedules exactly once, with the main product ----------

test("TEST 2: product-page.tsx's page component calls scheduleProductShadow exactly once, with the resolved main product, after the notFound() guard", async () => {
  const source = await read("app/_storefront/product-page.tsx");
  const pageFn = source.slice(source.indexOf("export default async function ProductPage"));
  const occurrences = pageFn.match(/scheduleProductShadow\(/g) ?? [];
  assert.equal(occurrences.length, 1, "exactly one call in the page component");
  const notFoundIndex = pageFn.indexOf("notFound();");
  const scheduleIndex = pageFn.indexOf("scheduleProductShadow(");
  assert.ok(notFoundIndex !== -1 && scheduleIndex > notFoundIndex, "scheduling happens after the not-found guard, i.e. only once `product` is confirmed to be the route's real subject");
  assert.match(pageFn.slice(scheduleIndex, scheduleIndex + 35), /^scheduleProductShadow\(product\);/);
  // generateMetadata (a separate export, also calls getProductBySlug) must NOT also schedule -- would double-fire.
  const metadataFn = source.slice(source.indexOf("export async function generateMetadata"), source.indexOf("export default async function ProductPage"));
  assert.doesNotMatch(metadataFn, /scheduleProductShadow/);
});

// ---------- TEST 3: repo-wide call-site audit -- exactly one productive occurrence, and it is the main-PDP boundary ----------

test("TEST 3: exactly one productive scheduleProductShadow(...) call site exists repo-wide, and it is app/_storefront/product-page.tsx (not products.ts, not productNavigation.ts, not any listing/search/category path)", async () => {
  const { execSync } = await import("node:child_process");
  const output = execSync('git grep -n "scheduleProductShadow(" -- "*.ts" "*.tsx"', { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  const lines = output.trim().split("\n").filter(Boolean);
  // Exclude the function's own definition line (services/catalog/productShadow.ts) -- that's a declaration, not a call.
  const calls = lines.filter((line) => !line.includes("services/catalog/productShadow.ts:9:export function scheduleProductShadow"));
  assert.equal(calls.length, 1, `expected exactly 1 call site, found: ${JSON.stringify(calls)}`);
  assert.ok(calls[0].startsWith("app/_storefront/product-page.tsx:"), `the one call site must be product-page.tsx, got: ${calls[0]}`);
});

test("TEST 3b: productNavigation.ts (family/category previous-next navigation) is functionally untouched by this fix -- still resolves adjacent products via getProductBySlug/getProductsByCategory, never calls scheduleProductShadow directly, and no SKU-specific hack was added", async () => {
  const source = await read("services/woocommerce/productNavigation.ts");
  assert.doesNotMatch(source, /scheduleProductShadow/);
  assert.match(source, /getProductBySlug\(adjacent\.previous\.slug\)/);
  assert.match(source, /getProductBySlug\(adjacent\.next\.slug\)/);
  assert.match(source, /getProductsByCategory\(/);
  // Structural fix, not a per-product patch: no hardcoded SKU/id conditionals.
  assert.doesNotMatch(source, /0117|0118|0122/);
  assert.doesNotMatch(source, /sku\s*===/i);
});

// ---------- TEST 4: same main product, multiple internal calls -- dedup unaffected ----------

test("TEST 4: getProductBySlug is still wrapped in React's cache() -- repeated same-slug calls (route resolver + metadata + page component) still collapse to one execution, unaffected by moving the shadow side effect elsewhere", async () => {
  const source = await read("services/woocommerce/products.ts");
  assert.match(source, /^import \{ cache \} from "react";/m);
  assert.match(source, /export const getProductBySlug = cache\(async function getProductBySlug\(/);
});

// ---------- TEST 5 / 6: mode=off / sample=0 => zero PIM runtime work (unaffected by this fix, reconfirmed) ----------

test("TEST 5: mode=off => zero PIM runtime work regardless of how many times scheduleProductShadow-equivalent work is invoked", async () => {
  const { runPimCatalogShadow } = await import("../lib/pim/publication-shadow-runtime.ts");
  const events = [];
  let dependencyCalled = false;
  const official = { sku: "SKU-MAIN", slug: "produto-principal", attributes: [{ code: "material", name: "Material", value: "PVC" }] };
  runPimCatalogShadow(official, "product", {
    mode: "off",
    sampleRatePercent: 100,
    telemetry: (event) => { events.push(event); },
    resolvePimProductId: async () => { dependencyCalled = true; return "prod-main"; },
    fetchPublishedAttributes: async () => new Map(),
    schedule: (work) => { work(); },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(dependencyCalled, false, "mode=off must short-circuit before any PIM dependency runs");
  assert.equal(events.length, 1);
  assert.equal(events[0].shadowStatus, "skipped_mode_off");
});

test("TEST 6: sample=0 => zero PIM runtime work", async () => {
  const { runPimCatalogShadow } = await import("../lib/pim/publication-shadow-runtime.ts");
  const events = [];
  let dependencyCalled = false;
  const official = { sku: "SKU-MAIN", slug: "produto-principal", attributes: [{ code: "material", name: "Material", value: "PVC" }] };
  runPimCatalogShadow(official, "product", {
    mode: "shadow",
    sampleRatePercent: 0,
    telemetry: (event) => { events.push(event); },
    resolvePimProductId: async () => { dependencyCalled = true; return "prod-main"; },
    fetchPublishedAttributes: async () => new Map(),
    schedule: (work) => { work(); },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(dependencyCalled, false, "sample=0 must short-circuit before any PIM dependency runs");
  assert.equal(events.length, 1);
  assert.equal(events[0].shadowStatus, "skipped_sampling");
});

// ---------- TEST 7: related/family navigation keeps returning products normally ----------

test("TEST 7: getFamilyNavigation still awaits BOTH getProductBySlug calls (previous and next) and still returns mapped summaries -- the navigation FEATURE is unaffected, only the shadow side effect moved away from it", async () => {
  const source = await read("services/woocommerce/productNavigation.ts");
  const fn = source.slice(source.indexOf("async function getFamilyNavigation"), source.indexOf("async function getCategoryNavigation"));
  assert.match(fn, /const \[previousProduct, nextProduct\] = await Promise\.all\(\[/);
  assert.match(fn, /if \(!previousProduct\) return undefined;/);
  assert.match(fn, /mapProductSummary\(previousProduct\)/);
});

// ---------- TEST 8: Woo official result invariance (cross-reference of existing, unmodified coverage) ----------

test("TEST 8: official response invariance remains covered by the existing, unmodified pimA36BOfficialResponseInvariance suite -- scheduleProductShadow still never mutates its input product and returns void", async () => {
  const source = await read("services/catalog/productShadow.ts");
  assert.match(source, /export function scheduleProductShadow\(product:Product\):void/);
  // This file itself (services/catalog/productShadow.ts) is untouched by R14-R2 --
  // only its CALLER moved. Confirmed here structurally: no new mutation of `product`.
  assert.doesNotMatch(source, /product\.\w+\s*=/);
});

// ---------- TEST 9: timeout protection intact (file untouched this round) ----------

test("TEST 9: lib/pim/publication-shadow-runtime.ts's timeout protection is untouched by this fix (500ms DEFAULT_TIMEOUT_MS, withTimeout wrapper both still present)", async () => {
  const source = await read("lib/pim/publication-shadow-runtime.ts");
  assert.match(source, /const DEFAULT_TIMEOUT_MS = 500;/);
  assert.match(source, /function withTimeout</);
  assert.match(source, /await withTimeout\(work, deps\.timeoutMs\)/);
});

// ---------- TEST 10: telemetry sink rejection protection intact (file untouched this round) ----------

test("TEST 10: lib/pim/publication-shadow-telemetry.ts's sink-rejection protection is untouched by this fix (toTelemetryFunction's try/catch + promise .catch still present)", async () => {
  const source = await read("lib/pim/publication-shadow-telemetry.ts");
  assert.match(source, /import "server-only";/);
  assert.match(source, /export function toTelemetryFunction\(sink: PimShadowTelemetrySink\): ShadowTelemetrySink/);
  const fn = source.slice(source.indexOf("export function toTelemetryFunction"));
  assert.match(fn, /try \{/);
  assert.match(fn, /\.catch\(\(\) => \{\}\);/);
});

// ---------- behavior summary required by the task's artifact shape ----------

test("AFTER fix: main product scheduled exactly once via the runtime, related/family products never reach scheduleProductShadow at all (0 events for them, by construction -- proven structurally in TEST 3, not by simulating a render)", async () => {
  const { runPimCatalogShadow } = await import("../lib/pim/publication-shadow-runtime.ts");
  const events = [];
  const mainOfficial = { sku: "0117", slug: "tubo-pvc-branco-roscavel-1-2-krona-6m", attributes: [{ code: "material", name: "Material", value: "PVC" }] };
  // Simulates exactly what now happens: ONE call, for the main product only.
  runPimCatalogShadow(mainOfficial, "product", {
    mode: "shadow",
    sampleRatePercent: 100,
    telemetry: (event) => { events.push(event); },
    resolvePimProductId: async () => "1b26a877-7163-40d6-a4f8-bf4d1ae2eb69",
    fetchPublishedAttributes: async () => new Map([["1b26a877-7163-40d6-a4f8-bf4d1ae2eb69", []]]),
    schedule: (work) => { work(); },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events.length, 1, "AFTER_MAIN_EVENT_COUNT=1");
  assert.equal(events[0].productId, "1b26a877-7163-40d6-a4f8-bf4d1ae2eb69");
  // No second/third call is ever made for 0118/0122 in this scenario --
  // that absence is what TEST 3's repo-wide call-site audit proves
  // structurally (AFTER_RELATED_EVENT_COUNT=0).
});
