// A3.6-D1: fail-safe telemetry sink SELECTION mechanism, prepared but not
// activated in any real environment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getConfiguredTelemetrySink, noopPimShadowTelemetrySink, consolePimShadowTelemetrySink } from "../lib/pim/publication-shadow-telemetry.ts";

test("getConfiguredTelemetrySink: missing PIM_SHADOW_TELEMETRY_SINK defaults to noop (fail-safe)", () => {
  assert.equal(getConfiguredTelemetrySink({}), noopPimShadowTelemetrySink);
});

test("getConfiguredTelemetrySink: unknown/malformed values default to noop, never accidentally select console", () => {
  assert.equal(getConfiguredTelemetrySink({ PIM_SHADOW_TELEMETRY_SINK: "CONSOLE" }), noopPimShadowTelemetrySink); // wrong case
  assert.equal(getConfiguredTelemetrySink({ PIM_SHADOW_TELEMETRY_SINK: "sentry" }), noopPimShadowTelemetrySink); // unknown provider
  assert.equal(getConfiguredTelemetrySink({ PIM_SHADOW_TELEMETRY_SINK: "" }), noopPimShadowTelemetrySink);
  assert.equal(getConfiguredTelemetrySink({ PIM_SHADOW_TELEMETRY_SINK: " console " }), noopPimShadowTelemetrySink); // whitespace not trimmed -- exact match only
});

test("getConfiguredTelemetrySink: exact 'console' selects the console sink", () => {
  assert.equal(getConfiguredTelemetrySink({ PIM_SHADOW_TELEMETRY_SINK: "console" }), consolePimShadowTelemetrySink);
});

test("runtime default telemetry now resolves via getConfiguredTelemetrySink (env-selectable), not a hardcoded noop -- source-shape proof", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/pim/publication-shadow-runtime.ts", import.meta.url), "utf8");
  const occurrences = (source.match(/toTelemetryFunction\(getConfiguredTelemetrySink\(\)\)/g) ?? []).length;
  assert.equal(occurrences, 2, "expected both runPimCatalogShadow and runPimCatalogShadowForList to resolve the sink this way");
});

test("no environment variable named PIM_SHADOW_TELEMETRY_SINK is set in the current process (nothing activated this round)", () => {
  assert.equal(process.env.PIM_SHADOW_TELEMETRY_SINK, undefined);
});
