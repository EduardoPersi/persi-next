// A3.6-B Section 21: shadow failure matrix + response invariance + sampling
// + batching + telemetry contract. All offline (injected dependencies), no
// real DB, no AI provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runPimCatalogShadow, runPimCatalogShadowForList, isSampled } from "../lib/pim/publication-shadow-runtime.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function official(overrides = {}) {
  return { sku: "SKU-1", slug: "produto-1", attributes: [{ code: "material", name: "Material", value: "PVC" }], ...overrides };
}

function record(overrides = {}) {
  return { productId: "prod-1", attributeId: "attr-1", attributeSlug: "material", attributeName: "Material", attributeValueId: "av-1", canonicalValue: "PVC", publicationState: "published", batchId: "batch-1", publishedAt: null, ...overrides };
}

// Synchronous scheduler for deterministic tests: runs `work` immediately
// and returns a promise the test can await, instead of racing a real
// post-response callback.
function syncSchedule(collector) {
  return (work) => { collector.promise = work(); };
}

async function runAndWait(fn, deps = {}) {
  const collector = {};
  const schedule = syncSchedule(collector);
  fn({ ...deps, schedule });
  await collector.promise;
}

// ---------- 1. mode=off ----------
test("failure matrix 1: mode=off => zero PIM calls, only MODE_OFF telemetry, no schedule invoked", () => {
  const events = [];
  let resolveCalled = false;
  runPimCatalogShadow(official(), "product", {
    mode: "off",
    telemetry: (e) => events.push(e),
    resolvePimProductId: async () => { resolveCalled = true; return "prod-1"; },
    schedule: () => { throw new Error("schedule should never be called when mode=off"); },
  });
  assert.equal(resolveCalled, false);
  assert.deepEqual(events.map((e) => e.shadowStatus), ["skipped_mode_off"]);
});

// ---------- 2. mode=shadow + zero publications ----------
test("failure matrix 2: mode=shadow, product has zero published attributes => completed, publishedAttributeCount=0", async () => {
  const events = [];
  await runAndWait((deps) => runPimCatalogShadow(official(), "product", { mode: "shadow", sampleRatePercent: 100, telemetry: (e) => events.push(e), resolvePimProductId: async () => "prod-1", fetchPublishedAttributes: async () => new Map([["prod-1", []]]), ...deps }));
  assert.equal(events.length, 1);
  assert.equal(events[0].shadowStatus, "completed");
  assert.equal(events[0].publishedAttributeCount, 0);
  assert.equal(events[0].classification, "OFFICIAL_ONLY");
});

// ---------- 3. mode=shadow + MATCH ----------
test("failure matrix 3: mode=shadow, PIM value matches official => classification MATCH", async () => {
  const events = [];
  await runAndWait((deps) => runPimCatalogShadow(official(), "product", { mode: "shadow", sampleRatePercent: 100, telemetry: (e) => events.push(e), resolvePimProductId: async () => "prod-1", fetchPublishedAttributes: async () => new Map([["prod-1", [record()]]]), ...deps }));
  assert.equal(events[0].classification, "MATCH");
  assert.equal(events[0].shadowStatus, "completed");
});

// ---------- 4. mode=shadow + VALUE_DIFFERENCE ----------
test("failure matrix 4: mode=shadow, PIM value differs from official => classification VALUE_DIFFERENCE", async () => {
  const events = [];
  await runAndWait((deps) => runPimCatalogShadow(official(), "product", { mode: "shadow", sampleRatePercent: 100, telemetry: (e) => events.push(e), resolvePimProductId: async () => "prod-1", fetchPublishedAttributes: async () => new Map([["prod-1", [record({ canonicalValue: "Alumínio" })]]]), ...deps }));
  assert.equal(events[0].classification, "VALUE_DIFFERENCE");
});

// ---------- 5. PIM DB timeout ----------
test("failure matrix 5: PIM DB call hangs past the timeout budget => shadowStatus=timeout, no throw escapes", async () => {
  const events = [];
  await runAndWait((deps) => runPimCatalogShadow(official(), "product", {
    mode: "shadow", sampleRatePercent: 100, timeoutMs: 20,
    telemetry: (e) => events.push(e),
    resolvePimProductId: () => new Promise(() => {}), // never resolves
    ...deps,
  }));
  assert.equal(events.length, 1);
  assert.equal(events[0].shadowStatus, "timeout");
  assert.equal(events[0].errorClass, "timeout");
});

// ---------- regression: abandoned work after a timeout must never emit a second telemetry event ----------
test("regression: after a timeout, the raced-away (uncancellable) work completing LATER must not emit a second telemetry event for the same observation", async () => {
  const events = [];
  let releaseSlowWork;
  const slowWork = new Promise((resolve) => { releaseSlowWork = resolve; });
  const collector = {};
  runPimCatalogShadow(official(), "product", {
    mode: "shadow", sampleRatePercent: 100, timeoutMs: 10,
    telemetry: (e) => events.push(e),
    resolvePimProductId: async () => { await slowWork; return "prod-1"; }, // resolves AFTER the timeout has already fired
    fetchPublishedAttributes: async () => new Map([["prod-1", [record()]]]),
    schedule: (work) => { collector.promise = work(); },
  });
  await new Promise((resolve) => setTimeout(resolve, 30)); // let the 10ms timeout fire first
  assert.equal(events.length, 1);
  assert.equal(events[0].shadowStatus, "timeout");
  releaseSlowWork(); // now let the abandoned work actually complete
  await collector.promise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(events.length, 1, "the late completion must NOT have emitted a second event");
});

// ---------- 6. PIM DB connection failure ----------
test("failure matrix 6: PIM DB rejects (connection failure) => shadowStatus=error, no throw escapes", async () => {
  const events = [];
  await runAndWait((deps) => runPimCatalogShadow(official(), "product", {
    mode: "shadow", sampleRatePercent: 100,
    telemetry: (e) => events.push(e),
    resolvePimProductId: async () => { throw new Error("ECONNREFUSED"); },
    ...deps,
  }));
  assert.equal(events[0].shadowStatus, "error");
  assert.equal(events[0].errorClass, "Error");
});

// ---------- 7. comparator throws ----------
test("failure matrix 7: comparator throws => shadowStatus=error, no throw escapes", async () => {
  const events = [];
  await runAndWait((deps) => runPimCatalogShadow(official(), "product", {
    mode: "shadow", sampleRatePercent: 100,
    telemetry: (e) => events.push(e),
    resolvePimProductId: async () => "prod-1",
    fetchPublishedAttributes: async () => new Map([["prod-1", [record()]]]),
    compare: () => { throw new Error("comparator exploded"); },
    ...deps,
  }));
  assert.equal(events[0].shadowStatus, "error");
});

// ---------- 8. telemetry throws ----------
test("failure matrix 8: telemetry sink itself throws => swallowed, never propagates", async () => {
  let threw = false;
  try {
    await runAndWait((deps) => runPimCatalogShadow(official(), "product", {
      mode: "shadow", sampleRatePercent: 100,
      telemetry: () => { throw new Error("telemetry sink is broken"); },
      resolvePimProductId: async () => "prod-1",
      fetchPublishedAttributes: async () => new Map([["prod-1", [record()]]]),
      ...deps,
    }));
  } catch { threw = true; }
  assert.equal(threw, false);
});

// ---------- 9. malformed publication row ----------
test("failure matrix 9: malformed publication record (null canonicalValue) does not crash the pipeline", async () => {
  const events = [];
  await runAndWait((deps) => runPimCatalogShadow(official(), "product", {
    mode: "shadow", sampleRatePercent: 100,
    telemetry: (e) => events.push(e),
    resolvePimProductId: async () => "prod-1",
    fetchPublishedAttributes: async () => new Map([["prod-1", [record({ canonicalValue: null })]]]),
    ...deps,
  }));
  assert.equal(events.length, 1);
  assert.notEqual(events[0].shadowStatus, undefined);
});

// ---------- 10/11/12: rolled_back / unpublished / missing source PAV never reach the orchestrator as published (read model already filtered) ----------
test("failure matrix 10-12: rolled_back batch, unpublished row, and missing source PAV are all represented as an EMPTY published-attributes map (the read model's job, already proven in A3.6-A) and the orchestrator handles that as zero publications, not an error", async () => {
  const events = [];
  await runAndWait((deps) => runPimCatalogShadow(official(), "product", {
    mode: "shadow", sampleRatePercent: 100,
    telemetry: (e) => events.push(e),
    resolvePimProductId: async () => "prod-1",
    fetchPublishedAttributes: async () => new Map([["prod-1", []]]), // simulates rolled_back/unpublished/missing-source, all already excluded upstream
    ...deps,
  }));
  assert.equal(events[0].shadowStatus, "completed");
  assert.equal(events[0].publishedAttributeCount, 0);
});

// ---------- 13. needs_review ----------
test("failure matrix 13: a NEEDS_REVIEW registry SKU/attribute is classified BLOCKED, never a false MATCH/publishable signal", async () => {
  const events = [];
  await runAndWait((deps) => runPimCatalogShadow(
    official({ sku: "PA013710", attributes: [{ code: "comprimento", name: "Comprimento", value: "1,5m" }] }),
    "product",
    {
      mode: "shadow", sampleRatePercent: 100,
      telemetry: (e) => events.push(e),
      resolvePimProductId: async () => "prod-1",
      fetchPublishedAttributes: async () => new Map([["prod-1", [record({ attributeSlug: "comprimento", canonicalValue: "1 Metro" })]]]),
      ...deps,
    },
  ));
  assert.equal(events[0].classification, "BLOCKED");
});

// ---------- 14. batch of multiple products ----------
test("failure matrix 14: runPimCatalogShadowForList handles multiple products in ONE resolve pass + ONE fetch call", async () => {
  const events = [];
  let fetchCallCount = 0;
  let resolveCallCount = 0;
  const officials = [official({ slug: "produto-1" }), official({ slug: "produto-2", sku: "SKU-2" })];
  await runAndWait((deps) => runPimCatalogShadowForList(officials, "category", {
    mode: "shadow", sampleRatePercent: 100,
    telemetry: (e) => events.push(e),
    resolvePimProductId: async (slug) => { resolveCallCount++; return slug === "produto-1" ? "prod-1" : "prod-2"; },
    fetchPublishedAttributes: async (ids) => { fetchCallCount++; return new Map(ids.map((id) => [id, [record({ productId: id })]])); },
    ...deps,
  }));
  assert.equal(fetchCallCount, 1, "expected exactly one batch fetch for the whole list");
  assert.equal(events.length, 2);
});

// ---------- 15. empty product list ----------
test("failure matrix 15: runPimCatalogShadowForList with an empty list is a safe no-op", async () => {
  let scheduled = false;
  runPimCatalogShadowForList([], "search", { mode: "shadow", sampleRatePercent: 100, schedule: () => { scheduled = true; } });
  assert.equal(scheduled, false);
});

// ---------- sampling ----------
test("isSampled: deterministic across repeated calls for the same key (not Math.random)", () => {
  const results = new Set();
  for (let i = 0; i < 20; i++) results.add(isSampled("produto-abc", 50));
  assert.equal(results.size, 1, "same key must always land in the same sample bucket");
});

test("isSampled: 0% never samples, 100% always samples", () => {
  assert.equal(isSampled("anything", 0), false);
  assert.equal(isSampled("anything", 100), true);
});

test("mode=shadow but sampleRatePercent=0 (the real default) => zero PIM calls, same as mode=off in practice", () => {
  let called = false;
  runPimCatalogShadow(official(), "product", { mode: "shadow", sampleRatePercent: 0, resolvePimProductId: async () => { called = true; return "prod-1"; }, schedule: (work) => { void work(); } });
  assert.equal(called, false);
});

// ---------- official response invariance ----------
test("runPimCatalogShadow never returns a value (void) -- cannot be composed into an official response by construction", () => {
  const result = runPimCatalogShadow(official(), "product", { mode: "off" });
  assert.equal(result, undefined);
});

test("runPimCatalogShadow does not mutate the official object passed to it", async () => {
  const off = official();
  const snapshot = JSON.parse(JSON.stringify(off));
  await runAndWait((deps) => runPimCatalogShadow(off, "product", { mode: "shadow", sampleRatePercent: 100, resolvePimProductId: async () => "prod-1", fetchPublishedAttributes: async () => new Map([["prod-1", [record()]]]), ...deps }));
  assert.deepEqual(off, snapshot);
});

// ---------- fail-open for official / fail-closed for PIM (Section 9) ----------
test("Section 9 contract: default scheduler failure (schedule not provided, no request context) does not throw synchronously -- falls back safely", () => {
  assert.doesNotThrow(() => {
    runPimCatalogShadow(official(), "product", { mode: "shadow", sampleRatePercent: 100, resolvePimProductId: async () => "prod-1", fetchPublishedAttributes: async () => new Map([["prod-1", [record()]]]) });
  });
});

// ---------- source-code shape assertions ----------

test("runtime shadow orchestrator never returns the comparison/candidate to its caller (architecture: schedule-and-return-official, not combine-and-decide)", async () => {
  const source = await read("lib/pim/publication-shadow-runtime.ts");
  const fn = source.slice(source.indexOf("export function runPimCatalogShadow("), source.indexOf("export function runPimCatalogShadowForList("));
  assert.match(fn, /: void/);
  assert.doesNotMatch(fn, /return\s+(comparison|candidate)/);
});

test("scheduleWithAfter prefers next/server's after() with a safe try/catch fallback, matching the documented architectural choice", async () => {
  const source = await read("lib/pim/publication-shadow-runtime.ts");
  const fn = source.slice(source.indexOf("function scheduleWithAfter"));
  assert.match(fn, /after\(work\)/);
  assert.match(fn, /catch[\s\S]*void work\(\)\.catch/);
});

test("mode='off' is checked before any dependency default (resolvePimProductId/fetchPublishedAttributes) is even referenced, guaranteeing zero PIM read when off", async () => {
  const source = await read("lib/pim/publication-shadow-runtime.ts");
  const fn = source.slice(source.indexOf("export function runPimCatalogShadow("), source.indexOf("export function runPimCatalogShadowForList("));
  const offCheckIndex = fn.indexOf('mode === "off"');
  const firstDefaultResolveIndex = fn.indexOf("defaultResolvePimProductId");
  assert.ok(offCheckIndex !== -1 && offCheckIndex < firstDefaultResolveIndex);
});
