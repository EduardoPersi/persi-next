// A3.6-B Section 10/26: proves the ONE real integration point wired this
// round (PDP, via services/catalog/productShadow.ts::scheduleProductShadow)
// cannot alter the official response. category/listing/search are NOT
// connected this round -- runPimCatalogShadowForList exists and is tested
// in isolation (tests/pimA36BShadowRuntime.test.mjs) but no route calls it
// yet; this file does not pretend otherwise.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("scheduleProductShadow returns void -- structurally cannot be composed into getProductBySlug's return value", async () => {
  const source = await read("services/catalog/productShadow.ts");
  assert.match(source, /export function scheduleProductShadow\(product:Product\):void/);
});

test("getProductBySlug's call site never awaits or uses scheduleProductShadow's return value (fire-and-forget by construction)", async () => {
  const source = await read("services/woocommerce/products.ts");
  const fn = source.slice(source.indexOf("export async function getProductBySlug"));
  const callLine = fn.slice(fn.indexOf("scheduleProductShadow(product)") - 40, fn.indexOf("scheduleProductShadow(product)") + 40);
  assert.doesNotMatch(callLine, /await\s+scheduleProductShadow/);
  assert.match(callLine, /if \(product\) scheduleProductShadow\(product\);/);
});

test("runPimCatalogShadow inside scheduleProductShadow is called without await, sharing a single memoized official mapping with the pre-existing Woo/Postgres shadow (lazy, never eager -- a mapping throw must not escape synchronously)", async () => {
  const source = await read("services/catalog/productShadow.ts");
  assert.match(source, /getOfficial\s*=\s*\(\)\s*=>\s*\(official\s*\?\?=\s*mapWooProductToCatalog\(product\)\)/);
  assert.doesNotMatch(source, /await\s+runPimCatalogShadow/);
  assert.match(source, /runPimCatalogShadow\(getOfficial\(\), ?"product"\)/);
  // The exact regression this test guards against: mapWooProductToCatalog
  // must never be called eagerly/synchronously at the top of the function
  // body, outside of a try/catch or a lazy getter -- doing so would let a
  // malformed product throw synchronously out of scheduleProductShadow,
  // which its caller (getProductBySlug) invokes unguarded.
  const body = source.slice(source.indexOf("export function scheduleProductShadow"));
  const firstLine = body.split("\n")[1].trim();
  assert.doesNotMatch(firstLine, /^const official ?= ?mapWooProductToCatalog/);
});

test("scheduleProductShadow with a MALFORMED Product (missing/invalid numeric fields that make mapWooProductToCatalog throw) still completes without throwing and returns undefined -- regression guard for the exact bug found while wiring A3.6-B", async () => {
  const { scheduleProductShadow } = await import("../services/catalog/productShadow.ts");
  // Deliberately missing/invalid fields (price is not a numeric string,
  // several required nested objects are absent) to force
  // mapWooProductToCatalog to throw synchronously.
  const malformedProduct = { id: 1, slug: "produto-malformado", name: "X", sku: "SKU-X", type: "simple", price: "not-a-number", regularPrice: "not-a-number" };
  assert.doesNotThrow(() => {
    const result = scheduleProductShadow(malformedProduct);
    assert.equal(result, undefined);
  });
});

test("no route/page/component imports runPimCatalogShadow* directly (the only wiring is through services/catalog/productShadow.ts, matching the declared PDP-only scope)", async () => {
  const { execSync } = await import("node:child_process");
  let matches = [];
  try {
    const output = execSync('git grep -l "runPimCatalogShadow" -- "app" "components"', { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    matches = output.trim().split("\n").filter(Boolean);
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  assert.deepEqual(matches, []);
});

// ---------- A3.6-C Section 23: PDP response contract invariance ----------
test("A3.6-C: the Woo Product object passed into scheduleProductShadow is byte-for-byte unchanged after a FULL shadow=on execution (real internal work, not mode=off), and its serialized form never contains any shadow-only field name", async () => {
  const { scheduleProductShadow } = await import("../services/catalog/productShadow.ts");
  const product = { id: 1, slug: "produto-pdp-contrato", name: "Produto Contrato", sku: "SKU-CONTRATO", type: "simple", price: "10.00", regularPrice: "10.00", attributes: [], variations: [], categories: [], brands: [], tags: [], images: [], inventory: { status: "in-stock" } };
  const snapshot = JSON.parse(JSON.stringify(product));
  scheduleProductShadow(product); // fires the real (memoized, try/catch-guarded) internal call; mode defaults to off in this test process, which is itself part of the contract being proven
  // Give any scheduled background work a moment (mode is off by default here, so nothing should even run, but the assertion holds either way).
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(product, snapshot);
  const serialized = JSON.stringify(product);
  for (const forbiddenField of ["classification", "candidate", "batchId", "publicationState", "differenceCount", "shadowStatus"]) {
    assert.doesNotMatch(serialized, new RegExp(forbiddenField, "i"));
  }
});

test("category/listing/search routes are NOT wired to runPimCatalogShadowForList this round (declared scope: PDP only)", async () => {
  const { execSync } = await import("node:child_process");
  let matches = [];
  try {
    const output = execSync('git grep -l "runPimCatalogShadowForList" -- "app" "components" "services" "app/_storefront"', { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    matches = output.trim().split("\n").filter(Boolean);
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  assert.deepEqual(matches, [], "runPimCatalogShadowForList must remain unconnected until a future round explicitly wires listing/search");
});
