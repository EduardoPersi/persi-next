// A3.7-A-R17-R2A: diagnostic-only observability for
// services/catalog/productFichaTecnica.ts's resolveFichaTecnicaSpecifications().
// Every test here proves the NEW instrumentation is purely observational --
// it never changes what is returned publicly, never writes, never calls a
// dependency function OFF/SHADOW didn't already call, and never logs a
// secret. Dependency-injected exactly like tests/pimA37AR15FichaTecnicaOrchestration.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveFichaTecnicaSpecifications } from "../services/catalog/productFichaTecnica.ts";
import { classifyRawPimModeForDiagnostics } from "../lib/pim/publication-ficha-tecnica-diagnostics.ts";
import { createCollectingFichaTecnicaTelemetrySink } from "../lib/pim/publication-ficha-tecnica-telemetry.ts";

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
  const sink = createCollectingFichaTecnicaTelemetrySink();
  return {
    mode: "canary",
    timeoutMs: 200,
    isSafeToRun: () => true,
    resolvePimProductId: async () => "pim-prod-1",
    getActiveCanaryMembership: async () => [{ productId: "pim-prod-1", attributeCode: "material", batchId: "batch-1" }],
    getPublishedAttributesForProduct: async () => [record()],
    evaluatePublicationEligibilityBatch: async (_db, identities) => new Map(identities.map((id) => [`${id.productId}:${id.attributeId}:${id.attributeValueId}`, { eligible: true, reasonCodes: [], sku: "SKU-1", attributeCode: "material", value: "PVC" }])),
    rawMode: "canary",
    diagnosticsEnabled: true,
    telemetry: sink,
    ...overrides,
  };
}

const lastEvent = (deps) => deps.telemetry.events.at(-1);

// ---------- Section 12: each early return ----------

test("A. mode=off: SKIPPED/MODE_NOT_CANARY, zero dependency calls, public result unchanged (undefined)", async () => {
  let calls = 0;
  const deps = baseDeps({ mode: "off", rawMode: "off", isSafeToRun: () => { calls++; return true; } });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  assert.equal(calls, 0);
  assert.equal(deps.telemetry.events.length, 1);
  const event = lastEvent(deps);
  assert.equal(event.resolvedMode, "off");
  assert.equal(event.modeRawClass, "EXACT_OFF");
  assert.equal(event.result, "SKIPPED");
  assert.equal(event.reason, "MODE_NOT_CANARY");
  assert.equal(event.membershipCount, null);
});

test("B. mode=shadow: SKIPPED/MODE_NOT_CANARY, zero dependency calls, shadow semantics untouched", async () => {
  let calls = 0;
  const deps = baseDeps({ mode: "shadow", rawMode: "shadow", isSafeToRun: () => { calls++; return true; } });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  assert.equal(calls, 0);
  const event = lastEvent(deps);
  assert.equal(event.resolvedMode, "shadow");
  assert.equal(event.modeRawClass, "EXACT_SHADOW");
  assert.equal(event.reason, "MODE_NOT_CANARY");
});

test("C. invalid/garbage mode string: current parser still resolves off (unchanged), diagnostics report it accurately", async () => {
  const deps = baseDeps({ mode: "off", rawMode: "totally-invalid" });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  const event = lastEvent(deps);
  assert.equal(event.resolvedMode, "off");
  assert.equal(event.modeRawClass, "OTHER");
  assert.equal(event.reason, "MODE_NOT_CANARY");
});

test("D. product unresolved: SKIPPED/PRODUCT_NOT_RESOLVED, productResolved=false", async () => {
  const deps = baseDeps({ resolvePimProductId: async () => null });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  const event = lastEvent(deps);
  assert.equal(event.productResolved, false);
  assert.equal(event.reason, "PRODUCT_NOT_RESOLVED");
  assert.equal(event.membershipCount, null);
});

test("E. membership zero: SKIPPED/NO_ACTIVE_CANARY_MEMBERSHIP, membershipCount=0", async () => {
  const deps = baseDeps({ getActiveCanaryMembership: async () => [] });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  const event = lastEvent(deps);
  assert.equal(event.productResolved, true);
  assert.equal(event.membershipCount, 0);
  assert.equal(event.reason, "NO_ACTIVE_CANARY_MEMBERSHIP");
});

test("F. published zero: SKIPPED/NO_PUBLISHED_ATTRIBUTES, publishedCount=0", async () => {
  const deps = baseDeps({ getPublishedAttributesForProduct: async () => [] });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  const event = lastEvent(deps);
  assert.equal(event.membershipCount, 1);
  assert.equal(event.publishedCount, 0);
  assert.equal(event.reason, "NO_PUBLISHED_ATTRIBUTES");
});

test("G'. intersection zero (published exists but not under a canary-membership code): SKIPPED/NO_INTERSECTION", async () => {
  const deps = baseDeps({ getPublishedAttributesForProduct: async () => [record({ attributeSlug: "comprimento" })] });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  const event = lastEvent(deps);
  assert.equal(event.publishedCount, 1);
  assert.equal(event.intersectionCount, 0);
  assert.equal(event.reason, "NO_INTERSECTION");
});

test("G. eligible zero: SKIPPED/NO_CURRENTLY_ELIGIBLE_ATTRIBUTES, eligibleCount=0", async () => {
  const deps = baseDeps({ evaluatePublicationEligibilityBatch: async () => new Map([["pim-prod-1:attr-1:av-1", { eligible: false, reasonCodes: ["NEEDS_REVIEW"], sku: "SKU-1", attributeCode: "material", value: "PVC" }]]) });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  const event = lastEvent(deps);
  assert.equal(event.intersectionCount, 1);
  assert.equal(event.eligibleCount, 0);
  assert.equal(event.reason, "NO_CURRENTLY_ELIGIBLE_ATTRIBUTES");
});

test("H. unsafe DB binding (Gate 0.5): SKIPPED/UNSAFE_DB_BINDING before any further dependency call", async () => {
  let calls = 0;
  const deps = baseDeps({ isSafeToRun: () => false, resolvePimProductId: async () => { calls++; return "x"; } });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  assert.equal(calls, 0);
  const event = lastEvent(deps);
  assert.equal(event.reason, "UNSAFE_DB_BINDING");
});

test("I. eligible attributes exist but merge adds nothing (e.g. every candidate classifies MATCH/VALUE_DIFFERENCE, not PIM_ONLY): SKIPPED/NO_SAFE_MERGE_ADDITIONS, public result stays undefined", async () => {
  // official already has "material"=PVC under the SAME reconciled code as the candidate -> MATCH, zero additions.
  const p = product({ attributes: [{ id: 1, name: "Material", taxonomy: "pa_material", hasVariations: false, terms: [{ id: 1, name: "PVC", slug: "pvc" }], options: [{ value: "pvc", label: "PVC", slug: "pvc" }] }] });
  const deps = baseDeps();
  const result = await resolveFichaTecnicaSpecifications(p, deps);
  assert.equal(result, undefined, "a MATCH must never surface as a public addition");
  const event = lastEvent(deps);
  assert.equal(event.eligibleCount, 1);
  assert.equal(event.mergeAdditionCount, 0);
  assert.equal(event.reason, "NO_SAFE_MERGE_ADDITIONS");
});

test("J. timeout: SKIPPED->ERROR result, reason=TIMEOUT, public result stays undefined", async () => {
  const deps = baseDeps({ timeoutMs: 10, resolvePimProductId: () => new Promise((resolve) => setTimeout(() => resolve("pim-prod-1"), 200)) });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  const event = lastEvent(deps);
  assert.equal(event.result, "ERROR");
  assert.equal(event.reason, "TIMEOUT");
});

test("J'. thrown dependency: SKIPPED->ERROR result, reason=ERROR, public result stays undefined", async () => {
  const deps = baseDeps({ getActiveCanaryMembership: async () => { throw new Error("boom"); } });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  const event = lastEvent(deps);
  assert.equal(event.result, "ERROR");
  assert.equal(event.reason, "ERROR");
});

// ---------- A3.7-A-R17-R2A-D6: per-stage timing instrumentation ----------

test("K. product resolution comfortably below budget: productResolutionMs is a small positive number, pipeline proceeds to SUCCESS", async () => {
  const deps = baseDeps({ timeoutMs: 300, resolvePimProductId: () => new Promise((resolve) => setTimeout(() => resolve("pim-prod-1"), 5)) });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.ok(Array.isArray(result));
  const event = lastEvent(deps);
  assert.ok(event.productResolutionMs !== null && event.productResolutionMs >= 5, `expected productResolutionMs >= 5, got ${event.productResolutionMs}`);
  assert.equal(event.reason, "SUCCESS");
});

test("L. product resolution consumes almost the entire budget but still completes: pipeline still reaches SUCCESS, productResolutionMs reflects the near-limit cost", async () => {
  const deps = baseDeps({ timeoutMs: 60, resolvePimProductId: () => new Promise((resolve) => setTimeout(() => resolve("pim-prod-1"), 40)) });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.ok(Array.isArray(result));
  const event = lastEvent(deps);
  assert.ok(event.productResolutionMs !== null && event.productResolutionMs >= 40);
  assert.equal(event.reason, "SUCCESS");
});

test("M. product resolution exceeds the budget: TIMEOUT fires, productResolutionMs stays null (that stage never completed), no later stage timing is populated either, public result stays undefined (Woo fallback)", async () => {
  const deps = baseDeps({ timeoutMs: 20, resolvePimProductId: () => new Promise((resolve) => setTimeout(() => resolve("pim-prod-1"), 200)) });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  const event = lastEvent(deps);
  assert.equal(event.reason, "TIMEOUT");
  assert.equal(event.productResolutionMs, null, "the stage in flight when the timeout fired must never report a fabricated duration");
  assert.equal(event.membershipMs, null);
  assert.equal(event.publicationReadMs, null);
  assert.equal(event.eligibilityMs, null);
  assert.equal(event.mergeMs, null);
});

test("N. timeout occurring AFTER product resolution completes but during membership lookup: productResolutionMs IS populated, membershipMs stays null -- proves per-stage timing correctly localizes which stage was in flight", async () => {
  const deps = baseDeps({
    timeoutMs: 30,
    resolvePimProductId: () => new Promise((resolve) => setTimeout(() => resolve("pim-prod-1"), 5)),
    getActiveCanaryMembership: () => new Promise((resolve) => setTimeout(() => resolve([{ productId: "pim-prod-1", attributeCode: "material", batchId: "batch-1" }]), 200)),
  });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  const event = lastEvent(deps);
  assert.equal(event.reason, "TIMEOUT");
  assert.ok(event.productResolutionMs !== null && event.productResolutionMs >= 5, "product resolution DID complete before the timeout fired, so its timing must be captured");
  assert.equal(event.membershipMs, null, "membership lookup was the stage in flight when the timeout fired");
});

test("O. late completion after a TIMEOUT never alters the already-returned public result or emits a second telemetry event", async () => {
  let resolveLate;
  const latePromise = new Promise((resolve) => { resolveLate = resolve; });
  const deps = baseDeps({
    timeoutMs: 15,
    resolvePimProductId: async () => { await latePromise; return "pim-prod-1"; },
  });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  assert.equal(deps.telemetry.events.length, 1);
  const firstEvent = deps.telemetry.events[0];
  // Let the abandoned resolvePimProductId call finally settle, well after
  // the function has already returned to its caller.
  resolveLate();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(deps.telemetry.events.length, 1, "a late-completing abandoned stage must never emit a second event");
  assert.deepEqual(deps.telemetry.events[0], firstEvent);
});

test("P. warm success under simulated realistic per-stage latency stays within a generous budget and still succeeds", async () => {
  const deps = baseDeps({
    timeoutMs: 300,
    resolvePimProductId: () => new Promise((resolve) => setTimeout(() => resolve("pim-prod-1"), 8)),
    getActiveCanaryMembership: () => new Promise((resolve) => setTimeout(() => resolve([{ productId: "pim-prod-1", attributeCode: "material", batchId: "batch-1" }]), 6)),
    getPublishedAttributesForProduct: () => new Promise((resolve) => setTimeout(() => resolve([record()]), 6)),
    evaluatePublicationEligibilityBatch: (_db, identities) => new Promise((resolve) => setTimeout(() => resolve(new Map(identities.map((id) => [`${id.productId}:${id.attributeId}:${id.attributeValueId}`, { eligible: true, reasonCodes: [], sku: "SKU-1", attributeCode: "material", value: "PVC" }]))), 6)),
  });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.ok(Array.isArray(result));
  const event = lastEvent(deps);
  assert.equal(event.reason, "SUCCESS");
  for (const key of ["productResolutionMs", "membershipMs", "publicationReadMs", "eligibilityMs", "mergeMs"]) {
    assert.equal(typeof event[key], "number");
  }
});

test("Q. simulated cold-start latency (a single slow stage close to the real 308ms overrun observed in staging) correctly fails closed via TIMEOUT with the default budget", async () => {
  const deps = baseDeps({ timeoutMs: 300, resolvePimProductId: () => new Promise((resolve) => setTimeout(() => resolve("pim-prod-1"), 320)) });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  const event = lastEvent(deps);
  assert.equal(event.reason, "TIMEOUT");
  assert.equal(event.productResolutionMs, null);
});

test("no writes: stage-timing instrumentation touches no database write statement anywhere", async () => {
  const source = await read("services/catalog/productFichaTecnica.ts");
  assert.doesNotMatch(source, /insert into|update public\.|delete from/i);
});

// ---------- Section 11: canary success, fixture fiel ao 0117 ----------

test("full 0117-shaped success: membership=3, published=3, eligible=3, intersection=3, mergeAdditionCount=3, result=SUCCESS/SUCCESS, Cor/Marca preserved plus the 3 PIM additions", async () => {
  const woo0117 = product({
    slug: "tubo-pvc-branco-roscavel-1-2-krona-6m",
    attributes: [
      { id: 1, name: "Cor", taxonomy: "pa_cor", hasVariations: false, terms: [{ id: 1, name: "Branco", slug: "branco" }], options: [{ value: "branco", label: "Branco", slug: "branco" }] },
      { id: 2, name: "Marca", taxonomy: "pa_marca", hasVariations: false, terms: [{ id: 2, name: "Krona", slug: "krona" }], options: [{ value: "krona", label: "Krona", slug: "krona" }] },
    ],
  });
  const published0117 = [
    record({ attributeId: "attr-comprimento", attributeSlug: "comprimento", attributeName: "Comprimento", attributeValueId: "av-comprimento", canonicalValue: "6m" }),
    record({ attributeId: "attr-conexao", attributeSlug: "conexao", attributeName: "Conexão", attributeValueId: "av-conexao", canonicalValue: "Roscável" }),
    record({ attributeId: "attr-material", attributeSlug: "material", attributeName: "Material", attributeValueId: "av-material", canonicalValue: "PVC" }),
  ];
  const deps = baseDeps({
    getActiveCanaryMembership: async () => [
      { productId: "pim-prod-1", attributeCode: "comprimento", batchId: "batch-1" },
      { productId: "pim-prod-1", attributeCode: "conexao", batchId: "batch-1" },
      { productId: "pim-prod-1", attributeCode: "material", batchId: "batch-1" },
    ],
    getPublishedAttributesForProduct: async () => published0117,
    evaluatePublicationEligibilityBatch: async (_db, identities) => new Map(identities.map((id) => [`${id.productId}:${id.attributeId}:${id.attributeValueId}`, { eligible: true, reasonCodes: [], sku: "0117", attributeCode: "x", value: "x" }])),
  });

  const result = await resolveFichaTecnicaSpecifications(woo0117, deps);
  assert.deepEqual(result, [
    { label: "Cor", value: "Branco" },
    { label: "Marca", value: "Krona" },
    { label: "Comprimento", value: "6m" },
    { label: "Conexão", value: "Roscável" },
    { label: "Material", value: "PVC" },
  ]);

  const event = lastEvent(deps);
  assert.equal(event.productResolved, true);
  assert.equal(event.membershipCount, 3);
  assert.equal(event.publishedCount, 3);
  assert.equal(event.intersectionCount, 3);
  assert.equal(event.eligibleCount, 3);
  assert.equal(event.mergeAdditionCount, 3);
  assert.equal(event.result, "SUCCESS");
  assert.equal(event.reason, "SUCCESS");
});

// ---------- Section 8: exactly one event per invocation (never zero when enabled, never two) ----------

test("exactly one telemetry event is emitted per resolveFichaTecnicaSpecifications call, across every gate outcome", async () => {
  const scenarios = [
    baseDeps({ mode: "off", rawMode: "off" }),
    baseDeps({ mode: "shadow", rawMode: "shadow" }),
    baseDeps({ isSafeToRun: () => false }),
    baseDeps({ resolvePimProductId: async () => null }),
    baseDeps({ getActiveCanaryMembership: async () => [] }),
    baseDeps({ getPublishedAttributesForProduct: async () => [] }),
    baseDeps(),
    baseDeps({ timeoutMs: 10, resolvePimProductId: () => new Promise((resolve) => setTimeout(() => resolve("x"), 200)) }),
  ];
  for (const deps of scenarios) {
    await resolveFichaTecnicaSpecifications(product(), deps);
    assert.equal(deps.telemetry.events.length, 1, `expected exactly 1 event, got ${deps.telemetry.events.length}`);
  }
});

test("structural: resolveFichaTecnicaSpecifications remains the ONLY call site (this round adds internal helpers, not new call sites) -- reaffirms the A3.7-A-R14-R2 lesson about family-navigation double-firing never applies here, since there is still exactly one caller", async () => {
  const { execSync } = await import("node:child_process");
  const output = execSync('git grep -n "resolveFichaTecnicaSpecifications(" -- "*.ts" "*.tsx"', { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  const lines = output.trim().split("\n").filter(Boolean);
  // Excludes the definition line itself AND doc-comment mentions (lines
  // whose content, after the "path:lineno:" prefix, starts with a comment
  // marker) -- only a real invocation counts as a call site.
  const callSites = lines.filter((line) => {
    if (line.includes("export async function resolveFichaTecnicaSpecifications")) return false;
    const content = line.replace(/^[^:]+:\d+:/, "").trim();
    if (content.startsWith("//") || content.startsWith("*") || content.startsWith("/*")) return false;
    return true;
  });
  assert.equal(callSites.length, 1, `expected exactly 1 real call site, found: ${JSON.stringify(callSites)}`);
  assert.ok(callSites[0].startsWith("app/_storefront/product-page.tsx:"));
});

// ---------- Section 9: OFF stays cheap even with diagnostics enabled ----------

test("OFF fast path: zero dependency calls even though diagnostics are enabled and an event IS still emitted (Gate 0 itself must remain provable)", async () => {
  let calls = 0;
  const spy = () => { calls++; return true; };
  const deps = baseDeps({
    mode: "off", rawMode: "off",
    isSafeToRun: spy,
    resolvePimProductId: async () => { calls++; return "x"; },
    getActiveCanaryMembership: async () => { calls++; return []; },
    getPublishedAttributesForProduct: async () => { calls++; return []; },
    evaluatePublicationEligibilityBatch: async () => { calls++; return new Map(); },
  });
  await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(calls, 0, "OFF must not execute a single PIM dependency call just to produce telemetry");
  assert.equal(deps.telemetry.events.length, 1);
});

// ---------- Section 10: SHADOW invariance ----------

test("SHADOW mode: identical zero-call short-circuit to OFF -- new instrumentation never publishes, merges, or duplicates calls for shadow", async () => {
  let calls = 0;
  const deps = baseDeps({ mode: "shadow", rawMode: "shadow", isSafeToRun: () => { calls++; return true; } });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  assert.equal(calls, 0);
});

// ---------- Section 13: parser raw-class fragility matrix (diagnostic only) ----------

test("modeRawClass matrix matches the required diagnostic classification for every input, without altering resolvedMode's real behavior", () => {
  const cases = [
    ["canary", "EXACT_CANARY"],
    [" canary", "TRIMMED_CANARY"],
    ["canary ", "TRIMMED_CANARY"],
    ["canary\r", "TRIMMED_CANARY"],
    ["canary\n", "TRIMMED_CANARY"],
    ["CANARY", "CASE_VARIANT"],
    ['"canary"', "QUOTED_VALUE"],
    [undefined, "MISSING"],
    ["off", "EXACT_OFF"],
    ["shadow", "EXACT_SHADOW"],
    ["garbage", "OTHER"],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(classifyRawPimModeForDiagnostics(raw), expected, `raw=${JSON.stringify(raw)}`);
  }
});

test("end-to-end: a real 'canary ' (trailing space) env value still resolves to the CURRENT parser's off behavior -- diagnostics report TRIMMED_CANARY without ever normalizing the real decision", async () => {
  // mode is what the REAL parser would resolve today for "canary " -- off.
  // This test proves the diagnostic layer does NOT quietly fix that.
  const deps = baseDeps({ mode: "off", rawMode: "canary " });
  const result = await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(result, undefined);
  const event = lastEvent(deps);
  assert.equal(event.resolvedMode, "off");
  assert.equal(event.modeRawClass, "TRIMMED_CANARY");
  assert.equal(event.reason, "MODE_NOT_CANARY");
});

// ---------- Section 3: parser itself untouched ----------

test("lib/pim/publication-flags.ts source is untouched by this round -- no .trim()/.toLowerCase()/quote-stripping was added to the real parser", async () => {
  const source = await read("lib/pim/publication-flags.ts");
  assert.match(source, /const mode: PimPublicationMode = raw === "shadow" \|\| raw === "canary" \? raw : "off";/, "the real parser's exact-match logic must remain byte-for-byte unchanged this round");
  assert.doesNotMatch(source, /\.trim\(\)|\.toLowerCase\(\)|\.toUpperCase\(\)|replace\(/);
});

// ---------- Section 14: log safety ----------

test("log safety: the diagnostic event never contains the raw env value, DATABASE_URL, secrets, tokens, cookies, HMAC/service-role material, PII, or SQL", async () => {
  const deps = baseDeps({ rawMode: "canary-but-secretly-a-token-abc123" });
  await resolveFichaTecnicaSpecifications(product(), deps);
  const event = lastEvent(deps);
  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /canary-but-secretly-a-token-abc123/, "the raw env string must never appear verbatim in the event");
  const forbidden = [/DATABASE_URL/i, /password/i, /token/i, /cookie/i, /authorization/i, /basic\s/i, /hmac/i, /service[_-]?role/i, /@.*\.(com|br|net|org)/i, /\bselect\b.*\bfrom\b/i, /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/];
  for (const pattern of forbidden) {
    assert.doesNotMatch(serialized, pattern, `event must not match forbidden pattern ${pattern}`);
  }
  const allowedKeys = ["resolvedMode", "modeRawClass", "productResolved", "membershipCount", "publishedCount", "intersectionCount", "eligibleCount", "mergeAdditionCount", "result", "reason", "durationMs", "productResolutionMs", "membershipMs", "publicationReadMs", "eligibilityMs", "mergeMs"];
  assert.deepEqual(Object.keys(event).sort(), allowedKeys.sort());
  for (const key of ["productResolutionMs", "membershipMs", "publicationReadMs", "eligibilityMs", "mergeMs"]) {
    assert.equal(typeof event[key], "number", `${key} must always be a plain number for this SUCCESS case`);
  }
});

test("classifyRawPimModeForDiagnostics never returns the raw string itself as part of its output", () => {
  const secret = "canary-token-should-never-leak-9f8e7d6c";
  const cls = classifyRawPimModeForDiagnostics(secret);
  assert.notEqual(cls, secret);
  assert.ok(!cls.includes("9f8e7d6c"));
});

// ---------- Section 15: production suppression ----------

test("production suppression: when PERSI_RUNTIME_ENV is not 'staging', zero diagnostic events are emitted, regardless of sink configuration", async () => {
  const sink = createCollectingFichaTecnicaTelemetrySink();
  const deps = baseDeps({ diagnosticsEnabled: false, telemetry: sink });
  await resolveFichaTecnicaSpecifications(product(), deps);
  assert.equal(sink.events.length, 0);
});

test("isFichaTecnicaDiagnosticsEnabled reads PERSI_RUNTIME_ENV and requires the exact literal 'staging'", async () => {
  const { isFichaTecnicaDiagnosticsEnabled } = await import("../lib/pim/publication-ficha-tecnica-telemetry.ts");
  assert.equal(isFichaTecnicaDiagnosticsEnabled({ PERSI_RUNTIME_ENV: "staging" }), true);
  assert.equal(isFichaTecnicaDiagnosticsEnabled({ PERSI_RUNTIME_ENV: "production" }), false);
  assert.equal(isFichaTecnicaDiagnosticsEnabled({}), false);
});

test("getConfiguredFichaTecnicaTelemetrySink defaults to noop and only activates on the exact literal 'console' -- same default-deny convention as the existing shadow telemetry sink", async () => {
  const { getConfiguredFichaTecnicaTelemetrySink, noopFichaTecnicaTelemetrySink } = await import("../lib/pim/publication-ficha-tecnica-telemetry.ts");
  assert.equal(getConfiguredFichaTecnicaTelemetrySink({}), noopFichaTecnicaTelemetrySink);
  assert.equal(getConfiguredFichaTecnicaTelemetrySink({ PIM_SHADOW_TELEMETRY_SINK: "garbage" }), noopFichaTecnicaTelemetrySink);
});

// ---------- no writes, no Woo writes (carried over guard, re-affirmed after this round's changes) ----------

test("no DB writes and no Woo write function anywhere in the new diagnostics/telemetry files", async () => {
  const diag = await read("lib/pim/publication-ficha-tecnica-diagnostics.ts");
  const telem = await read("lib/pim/publication-ficha-tecnica-telemetry.ts");
  for (const source of [diag, telem]) {
    assert.doesNotMatch(source, /insert into|update public\.|delete from/i);
    assert.doesNotMatch(source, /storeApiPost|storeApiPut|storeApiDelete/);
  }
});
