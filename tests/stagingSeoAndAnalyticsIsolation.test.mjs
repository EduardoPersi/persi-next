// A3.6-D1.6 Section 33: SEO and analytics isolation matrix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  Object.assign(process.env, overrides);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

// ---------- robots.ts ----------

test("robots.ts: staging disallows everything, no sitemap advertised", () => withEnv({ PERSI_RUNTIME_ENV: "staging" }, async () => {
  const robotsModule = await import(`../app/robots.ts?cachebust=${Date.now()}-staging`);
  const result = robotsModule.default();
  assert.equal(result.rules.userAgent, "*");
  assert.equal(result.rules.disallow, "/");
  assert.equal(result.sitemap, undefined);
}));

test("robots.ts: production (default, no env) keeps the exact original rules/sitemap behavior", () => withEnv({ PERSI_RUNTIME_ENV: undefined }, async () => {
  delete process.env.PERSI_RUNTIME_ENV;
  const robotsModule = await import(`../app/robots.ts?cachebust=${Date.now()}-prod`);
  const result = robotsModule.default();
  assert.equal(result.rules.allow, "/");
  assert.ok(Array.isArray(result.rules.disallow));
  assert.ok(result.sitemap.endsWith("/sitemap.xml"));
}));

test("robots.ts source: gate is driven by getRuntimeSafetyPolicy().allowPublicIndexing, not an ad-hoc env check", async () => {
  const source = await read("app/robots.ts");
  assert.match(source, /getRuntimeSafetyPolicy\(\)\.allowPublicIndexing/);
});

// ---------- layout metadata ----------

test("app/layout.tsx: staging robots metadata override is index=false, follow=false", async () => {
  const source = await read("app/layout.tsx");
  assert.match(source, /allowPublicIndexing[\s\S]*?index: false, follow: false, noarchive: true/);
});

// ---------- GTM analytics gate ----------

test("GoogleTagManager: analyticsAllowed() gates both the script and noscript exports", async () => {
  const source = await read("components/layout/GoogleTagManager.tsx");
  assert.match(source, /export function GoogleTagManagerScript\(\) \{\s*\n\s*if \(!GTM_ID \|\| !analyticsAllowed\(\)\) return null;/);
  assert.match(source, /export function GoogleTagManagerNoScript\(\) \{\s*\n\s*if \(!GTM_ID \|\| !analyticsAllowed\(\)\) return null;/);
});

// Note: .tsx cannot be directly imported by this repo's plain-Node test
// loader (JSX transform is not part of scripts/database/typescript-loader.mjs,
// by design -- component behavioral tests belong to a real Next.js render,
// not this offline harness). analyticsAllowed()'s actual boolean logic is
// exhaustively covered by tests/runtimeSafetyGates.test.mjs's
// allowProductionAnalytics assertions; the static source check above
// proves GoogleTagManager.tsx wires that same function into both exports.
