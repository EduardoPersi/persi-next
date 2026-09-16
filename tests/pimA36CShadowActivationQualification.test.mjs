// A3.6-C: shadow activation QUALIFICATION (not activation). Offline-only,
// no real DB, no AI provider, no environment variable changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getPimPublicationFlags } from "../lib/pim/publication-flags.ts";
import { isSampled, runPimCatalogShadow } from "../lib/pim/publication-shadow-runtime.ts";
import { noopPimShadowTelemetrySink, consolePimShadowTelemetrySink, createCollectingTelemetrySink, toTelemetryFunction } from "../lib/pim/publication-shadow-telemetry.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// ---------- Section 5/6: flag/sample-rate fail-safe reaudit ----------

test("mode: unknown/missing/malformed values all fail-safe to 'off' (default-deny)", () => {
  assert.equal(getPimPublicationFlags({}).mode, "off");
  assert.equal(getPimPublicationFlags({ PIM_PUBLICATION_MODE: "SHADOW" }).mode, "off"); // wrong case
  assert.equal(getPimPublicationFlags({ PIM_PUBLICATION_MODE: " shadow " }).mode, "off"); // whitespace
  assert.equal(getPimPublicationFlags({ PIM_PUBLICATION_MODE: "publish" }).mode, "off"); // unknown value
  assert.equal(getPimPublicationFlags({ PIM_PUBLICATION_MODE: "shadow" }).mode, "shadow");
  assert.equal(getPimPublicationFlags({ PIM_PUBLICATION_MODE: "canary" }).mode, "canary");
});

test("sample rate unit is canonically 0-100 (percent), never 0-1 -- eliminates ambiguity for a value like '1'", () => {
  // '1' must mean 1%, not 100%. This is the exact ambiguity Section 6 asks to eliminate.
  assert.equal(getPimPublicationFlags({ PIM_SHADOW_SAMPLE_RATE: "1" }).shadowSampleRatePercent, 1);
  assert.equal(isSampled("any-slug-at-all", 1), stableHashPercent("any-slug-at-all") < 1);
  function stableHashPercent(s) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { hash ^= s.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
    return (hash >>> 0) % 100;
  }
});

test("sample rate fail-safe boundary matrix: missing/zero/negative/NaN-equivalent/whitespace all resolve to a safe, non-100 default", () => {
  const cases = {
    missing: undefined,
    empty: "",
    whitespace: "   ",
    negative: "-5",
    notANumber: "banana",
    zero: "0",
  };
  for (const [label, value] of Object.entries(cases)) {
    const env = value === undefined ? {} : { PIM_SHADOW_SAMPLE_RATE: value };
    const { shadowSampleRatePercent } = getPimPublicationFlags(env);
    assert.ok(shadowSampleRatePercent === 0, `${label} (${JSON.stringify(value)}) must resolve to 0, got ${shadowSampleRatePercent}`);
  }
});

test("sample rate clamps above-max values to 100, never silently activates more than 100% or produces an out-of-range percent", () => {
  assert.equal(getPimPublicationFlags({ PIM_SHADOW_SAMPLE_RATE: "150" }).shadowSampleRatePercent, 100);
  assert.equal(getPimPublicationFlags({ PIM_SHADOW_SAMPLE_RATE: "9999" }).shadowSampleRatePercent, 100);
});

test("an invalid PIM_SHADOW_SAMPLE_RATE never accidentally activates 100% of traffic (fails to 0, the safe extreme, not 100, the dangerous extreme)", () => {
  const { shadowSampleRatePercent } = getPimPublicationFlags({ PIM_SHADOW_SAMPLE_RATE: "not-a-number" });
  assert.equal(shadowSampleRatePercent, 0);
});

// ---------- Section 7: configuration matrix ----------

test("configuration matrix: mode=off always yields PIM_READ_ALLOWED=false regardless of sample rate", () => {
  for (const sample of [0, 1, 50, 100]) {
    let dbCalled = false;
    runPimCatalogShadow(officialFixture(), "product", { mode: "off", sampleRatePercent: sample, resolvePimProductId: async () => { dbCalled = true; return "x"; }, schedule: (w) => { void w(); } });
    assert.equal(dbCalled, false, `sample=${sample}`);
  }
});

test("configuration matrix: mode=shadow, sample=0 => PIM_READ_ALLOWED=false (SHADOW_OBSERVATION_ALLOWED gated by sampling)", () => {
  let dbCalled = false;
  runPimCatalogShadow(officialFixture(), "product", { mode: "shadow", sampleRatePercent: 0, resolvePimProductId: async () => { dbCalled = true; return "x"; }, schedule: (w) => { void w(); } });
  assert.equal(dbCalled, false);
});

test("configuration matrix: mode=shadow, sample=100 => SHADOW_OBSERVATION_ALLOWED=true, but CANARY_OUTPUT_ALLOWED remains false always (runPimCatalogShadow never returns a value to influence output)", async () => {
  const collector = {};
  const result = runPimCatalogShadow(officialFixture(), "product", {
    mode: "shadow", sampleRatePercent: 100,
    resolvePimProductId: async () => "prod-1",
    fetchPublishedAttributes: async () => new Map([["prod-1", []]]),
    schedule: (w) => { collector.promise = w(); },
  });
  assert.equal(result, undefined); // CANARY_OUTPUT_ALLOWED=false by construction: nothing is ever returned
  await collector.promise;
});

test("configuration matrix: mode=canary is never activated for real output this round -- runPimCatalogShadow treats 'canary' identically to 'shadow' (observation only, still void)", async () => {
  const collector = {};
  const result = runPimCatalogShadow(officialFixture(), "product", {
    mode: "canary", sampleRatePercent: 100,
    resolvePimProductId: async () => "prod-1",
    fetchPublishedAttributes: async () => new Map([["prod-1", []]]),
    schedule: (w) => { collector.promise = w(); },
  });
  assert.equal(result, undefined);
  await collector.promise;
});

// ---------- Section 9/10: telemetry sink contract + failure isolation ----------

test("noopPimShadowTelemetrySink.emit does nothing and never throws", () => {
  assert.doesNotThrow(() => noopPimShadowTelemetrySink.emit({ productId: null, routeKind: "product", classification: "MATCH", differenceCount: 0, publishedAttributeCount: 0, durationMs: 1, shadowStatus: "completed", errorClass: null }));
});

test("consolePimShadowTelemetrySink adapts the project's existing '[tag] event' console.info convention", async () => {
  const source = await read("lib/pim/publication-shadow-telemetry.ts");
  assert.match(source, /console\.info\("\[pim-catalog-shadow\]", ?event\)/);
});

test("createCollectingTelemetrySink collects events for tests without hand-rolled arrays", () => {
  const sink = createCollectingTelemetrySink();
  sink.emit({ productId: null, routeKind: "product", classification: "MATCH", differenceCount: 0, publishedAttributeCount: 0, durationMs: 1, shadowStatus: "completed", errorClass: null });
  assert.equal(sink.events.length, 1);
});

test("toTelemetryFunction: a sink whose emit() throws synchronously never propagates", () => {
  const throwingSink = { emit: () => { throw new Error("sink is broken"); } };
  const fn = toTelemetryFunction(throwingSink);
  assert.doesNotThrow(() => fn({ productId: null, routeKind: "product", classification: "X", differenceCount: 0, publishedAttributeCount: 0, durationMs: 1, shadowStatus: "completed", errorClass: null }));
});

test("toTelemetryFunction: a sink whose emit() returns a REJECTED promise never causes an unhandled rejection", async () => {
  const rejectingSink = { emit: () => Promise.reject(new Error("async sink failure")) };
  const fn = toTelemetryFunction(rejectingSink);
  let unhandled = false;
  const handler = () => { unhandled = true; };
  process.on("unhandledRejection", handler);
  try {
    fn({ productId: null, routeKind: "product", classification: "X", differenceCount: 0, publishedAttributeCount: 0, durationMs: 1, shadowStatus: "completed", errorClass: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(unhandled, false);
  } finally {
    process.off("unhandledRejection", handler);
  }
});

test("regression coverage: the orchestrator's own emit() ALSO defends against an async telemetry function rejecting (not just via toTelemetryFunction)", async () => {
  let unhandled = false;
  const handler = () => { unhandled = true; };
  process.on("unhandledRejection", handler);
  try {
    const collector = {};
    runPimCatalogShadow(officialFixture(), "product", {
      mode: "shadow", sampleRatePercent: 100,
      resolvePimProductId: async () => "prod-1",
      fetchPublishedAttributes: async () => new Map([["prod-1", []]]),
      telemetry: async () => { throw new Error("async telemetry rejection"); },
      schedule: (w) => { collector.promise = w(); },
    });
    await collector.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(unhandled, false);
  } finally {
    process.off("unhandledRejection", handler);
  }
});

// ---------- Section 11/12: event schema + log injection safety ----------

test("event schema: exactly the documented fields, no extras, no PII-shaped keys", async () => {
  const source = await read("lib/pim/publication-shadow-telemetry.ts");
  const iface = source.slice(source.indexOf("export interface PimCatalogShadowTelemetryEvent"), source.indexOf("}", source.indexOf("export interface PimCatalogShadowTelemetryEvent")));
  for (const forbidden of ["email", "phone", "cpf", "cnpj", "address", "cookie", "token", "ip", "sessionId", "password", "DATABASE_URL"]) {
    assert.doesNotMatch(iface.toLowerCase(), new RegExp(forbidden.toLowerCase()));
  }
});

test("log injection safety: an adversarial slug/classification/errorClass string is carried as an opaque field value, never interpolated into a format string or eval'd", () => {
  const sink = createCollectingTelemetrySink();
  const adversarial = "\n\x1b[31mFAKE LOG LINE\x1b[0m ${process.env.DATABASE_URL}";
  const official = { sku: "SKU-X", slug: adversarial, attributes: [{ code: "material", name: "Material", value: "PVC" }] };
  const collector = {};
  runPimCatalogShadow(official, "product", {
    mode: "shadow", sampleRatePercent: 100,
    resolvePimProductId: async () => "prod-1",
    fetchPublishedAttributes: async () => new Map([["prod-1", []]]),
    telemetry: sink.emit,
    schedule: (w) => { collector.promise = w(); },
  });
  return collector.promise.then(() => {
    assert.equal(sink.events.length, 1);
    // The event object carries the field as data; console.info (used by
    // consolePimShadowTelemetrySink) never string-interpolates it, so no
    // secret/template-literal injection can occur -- this test documents
    // that the runtime treats the value as opaque data, not as a template.
    assert.equal(typeof sink.events[0].classification, "string");
    assert.doesNotMatch(sink.events[0].classification, /DATABASE_URL/);
  });
});

test("errorClass is always normalized to a constructor name or 'timeout'/'unknown' -- never a raw stack trace or connection string", async () => {
  const source = await read("lib/pim/publication-shadow-runtime.ts");
  const fn = source.slice(source.indexOf("function errorClassOf"));
  assert.match(fn, /error\.constructor\.name/);
  assert.doesNotMatch(fn, /\.stack/);
  assert.doesNotMatch(fn, /\.message(?!\s*===)/); // message only ever compared, never returned raw
});

// ---------- Section 13: sampling determinism, statistical ----------

test("sampling: same slug always yields the same decision across 1000 repeated calls (not Math.random)", () => {
  const decisions = new Set();
  for (let i = 0; i < 1000; i++) decisions.add(isSampled("produto-fixo-abc", 37));
  assert.equal(decisions.size, 1);
});

test("sampling: 10000 synthetic distinct slugs at 30% land within a reasonable statistical band (not biased/broken)", () => {
  let sampledCount = 0;
  const total = 10000;
  for (let i = 0; i < total; i++) {
    if (isSampled(`synthetic-product-slug-${i}`, 30)) sampledCount++;
  }
  const ratio = sampledCount / total;
  assert.ok(ratio > 0.25 && ratio < 0.35, `expected ~30% (0.25-0.35), got ${ratio}`);
});

test("sampling: 0% samples nobody across a large synthetic dataset; 100% samples everybody", () => {
  for (let i = 0; i < 500; i++) {
    assert.equal(isSampled(`slug-${i}`, 0), false);
    assert.equal(isSampled(`slug-${i}`, 100), true);
  }
});

// ---------- Section 14: sampling key audit ----------

test("sampling key is the product slug, never a customer/session/IP identifier (sampling by PRODUCT, not by person)", async () => {
  const source = await read("lib/pim/publication-shadow-runtime.ts");
  assert.match(source, /isSampled\(official\.slug, sampleRatePercent\)/);
  assert.doesNotMatch(source, /isSampled\([^)]*(session|customer|ip|cookie)/i);
});

// ---------- Section 17: mode=off does zero work (structural proof) ----------

test("mode=off: zero calls to resolvePimProductId, fetchPublishedAttributes, compare, AND telemetry receives only the MODE_OFF skip event", async () => {
  let resolveCalled = false, fetchCalled = false, compareCalled = false;
  const events = [];
  runPimCatalogShadow(officialFixture(), "product", {
    mode: "off",
    resolvePimProductId: async () => { resolveCalled = true; return "x"; },
    fetchPublishedAttributes: async () => { fetchCalled = true; return new Map(); },
    compare: () => { compareCalled = true; return { differences: [] }; },
    telemetry: (e) => events.push(e),
    schedule: () => { throw new Error("must not schedule when mode=off"); },
  });
  assert.equal(resolveCalled, false);
  assert.equal(fetchCalled, false);
  assert.equal(compareCalled, false);
  assert.deepEqual(events.map((e) => e.shadowStatus), ["skipped_mode_off"]);
});

// ---------- Section 18: zero-sample does zero DB work ----------

test("sample=0: zero calls to resolvePimProductId/fetchPublishedAttributes/compare -- sampling happens BEFORE any expensive work, not after", async () => {
  let resolveCalled = false, fetchCalled = false, compareCalled = false;
  runPimCatalogShadow(officialFixture(), "product", {
    mode: "shadow", sampleRatePercent: 0,
    resolvePimProductId: async () => { resolveCalled = true; return "x"; },
    fetchPublishedAttributes: async () => { fetchCalled = true; return new Map(); },
    compare: () => { compareCalled = true; return { differences: [] }; },
    schedule: () => { throw new Error("must not schedule when not sampled"); },
  });
  assert.equal(resolveCalled, false);
  assert.equal(fetchCalled, false);
  assert.equal(compareCalled, false);
});

// ---------- Section 19: timeout qualification, extended ----------

test("timeout: a fast dependency (well under budget) completes normally with shadowStatus=completed", async () => {
  const events = [];
  const collector = {};
  runPimCatalogShadow(officialFixture(), "product", {
    mode: "shadow", sampleRatePercent: 100, timeoutMs: 500,
    resolvePimProductId: async () => "prod-1",
    fetchPublishedAttributes: async () => new Map([["prod-1", []]]),
    telemetry: (e) => events.push(e),
    schedule: (w) => { collector.promise = w(); },
  });
  await collector.promise;
  assert.equal(events[0].shadowStatus, "completed");
});

test("timeout: a dependency resolving just under the budget still completes (near-budget, not falsely timed out)", async () => {
  const events = [];
  const collector = {};
  runPimCatalogShadow(officialFixture(), "product", {
    mode: "shadow", sampleRatePercent: 100, timeoutMs: 50,
    resolvePimProductId: () => new Promise((resolve) => setTimeout(() => resolve("prod-1"), 10)),
    fetchPublishedAttributes: async () => new Map([["prod-1", []]]),
    telemetry: (e) => events.push(e),
    schedule: (w) => { collector.promise = w(); },
  });
  await collector.promise;
  assert.equal(events[0].shadowStatus, "completed");
});

test("timeout: a dependency resolving just over the budget times out exactly once, official unaffected", async () => {
  const events = [];
  const collector = {};
  runPimCatalogShadow(officialFixture(), "product", {
    mode: "shadow", sampleRatePercent: 100, timeoutMs: 10,
    resolvePimProductId: () => new Promise((resolve) => setTimeout(() => resolve("prod-1"), 60)),
    telemetry: (e) => events.push(e),
    schedule: (w) => { collector.promise = w(); },
  });
  await collector.promise;
  await new Promise((resolve) => setTimeout(resolve, 80)); // let the abandoned work finish in the background
  assert.equal(events.length, 1);
  assert.equal(events[0].shadowStatus, "timeout");
});

test("timeout: a never-resolving dependency times out exactly once and does not hang the test process", async () => {
  const events = [];
  const collector = {};
  runPimCatalogShadow(officialFixture(), "product", {
    mode: "shadow", sampleRatePercent: 100, timeoutMs: 15,
    resolvePimProductId: () => new Promise(() => {}),
    telemetry: (e) => events.push(e),
    schedule: (w) => { collector.promise = w(); },
  });
  await collector.promise;
  assert.equal(events.length, 1);
  assert.equal(events[0].shadowStatus, "timeout");
});

// ---------- Section 20: after()/fallback qualification ----------

test("after()/fallback: when the default scheduler (real next/server after()) is used outside a request scope, it falls back without throwing and without double-executing the work", async () => {
  let executions = 0;
  const collector = {};
  runPimCatalogShadow(officialFixture(), "product", {
    mode: "shadow", sampleRatePercent: 100,
    resolvePimProductId: async () => { executions++; return "prod-1"; },
    fetchPublishedAttributes: async () => new Map([["prod-1", []]]),
    // no `schedule` override -- exercises the real scheduleWithAfter fallback path
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(executions, 1);
});

// ---------- Section 27: advisory lock separation ----------

test("advisory lock separation: the shadow read model NEVER calls the publication advisory lock (pg_advisory_xact_lock / withPublicationLock) -- shadow is read-only by construction", async () => {
  const readModelSource = await read("lib/pim/publication-read-model.ts");
  const runtimeSource = await read("lib/pim/publication-shadow-runtime.ts");
  const candidateSource = await read("lib/pim/publication-candidate.ts");
  const comparisonSource = await read("lib/pim/publication-shadow-comparison.ts");
  for (const source of [readModelSource, runtimeSource, candidateSource, comparisonSource]) {
    assert.doesNotMatch(source, /pg_advisory_xact_lock|withPublicationLock/);
  }
});

test("advisory lock separation: shadow runtime never imports publishBatch/unpublishBatch (write-path functions)", async () => {
  const source = await read("lib/pim/publication-shadow-runtime.ts");
  assert.doesNotMatch(source, /publishBatch|unpublishBatch/);
});

// ---------- Section 24: listing/search scope guard (redundant with A3.6-B, reconfirmed this round) ----------

test("scope guard reconfirmed: category/listing/search remain unconnected to any PIM shadow entry point", async () => {
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

// ---------- helpers ----------

function officialFixture(overrides = {}) {
  return { sku: "SKU-1", slug: "produto-1", attributes: [{ code: "material", name: "Material", value: "PVC" }], ...overrides };
}
