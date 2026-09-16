// A3.6-D1.5 Section 18/20: the DISABLE_PIM_SHADOW safety guard -- when
// DATABASE_URL is not bound to the expected staging project ref, the
// shadow runtime forces effective mode=off rather than crashing the whole
// process or (worse) silently reading from an unexpected database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPimShadowSafeToRun, checkDatabaseBinding, EXPECTED_STAGING_PROJECT_REF } from "../lib/pim/publication-runtime-preflight.ts";
import { runPimCatalogShadow } from "../lib/pim/publication-shadow-runtime.ts";

function officialFixture() {
  return { sku: "SKU-1", slug: "produto-1", attributes: [{ code: "material", name: "Material", value: "PVC" }] };
}

test("isPimShadowSafeToRun: true for a connection string matching the expected staging ref", () => {
  const url = `postgresql://postgres.${EXPECTED_STAGING_PROJECT_REF}:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;
  assert.equal(isPimShadowSafeToRun(url), true);
});

test("isPimShadowSafeToRun: false for a DIFFERENT project ref (e.g. a hypothetical production database)", () => {
  const url = "postgresql://postgres.someotherref:x@aws-0-sa-east-1.pooler.supabase.com:5432/postgres";
  assert.equal(isPimShadowSafeToRun(url), false);
});

test("isPimShadowSafeToRun: false when DATABASE_URL is empty/missing", () => {
  assert.equal(isPimShadowSafeToRun(""), false);
});

test("runPimCatalogShadow: mode=shadow but isSafeToRun=false => DISABLE_PIM_SHADOW, zero PIM DB calls, telemetry reports UNSAFE_DB_BINDING", () => {
  let resolveCalled = false;
  const events = [];
  runPimCatalogShadow(officialFixture(), "product", {
    mode: "shadow", sampleRatePercent: 100,
    isSafeToRun: () => false,
    resolvePimProductId: async () => { resolveCalled = true; return "x"; },
    telemetry: (e) => events.push(e),
    schedule: () => { throw new Error("must not schedule when binding is unsafe"); },
  });
  assert.equal(resolveCalled, false);
  assert.deepEqual(events.map((e) => e.shadowStatus), ["skipped_mode_off"]);
  assert.equal(events[0].classification, "UNSAFE_DB_BINDING");
});

test("runPimCatalogShadow: mode=shadow AND isSafeToRun=true proceeds normally (guard does not block the legitimate case)", async () => {
  const collector = {};
  const events = [];
  runPimCatalogShadow(officialFixture(), "product", {
    mode: "shadow", sampleRatePercent: 100,
    isSafeToRun: () => true,
    resolvePimProductId: async () => "prod-1",
    fetchPublishedAttributes: async () => new Map([["prod-1", []]]),
    telemetry: (e) => events.push(e),
    schedule: (w) => { collector.promise = w(); },
  });
  await collector.promise;
  assert.equal(events[0].shadowStatus, "completed");
});

test("checkDatabaseBinding result is safe to log/print -- never contains the password from the input string", () => {
  const url = `postgresql://postgres.${EXPECTED_STAGING_PROJECT_REF}:MY_SECRET@host:5432/postgres`;
  const serialized = JSON.stringify(checkDatabaseBinding(url));
  assert.doesNotMatch(serialized, /MY_SECRET/);
});

test("the guard is checked before sampling and before any dependency default -- source order proof", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/pim/publication-shadow-runtime.ts", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("export function runPimCatalogShadow("), source.indexOf("export function runPimCatalogShadowForList("));
  const guardIndex = fn.indexOf("isSafeToRun()");
  const samplingIndex = fn.indexOf("isSampled(");
  assert.ok(guardIndex !== -1 && guardIndex < samplingIndex);
});
