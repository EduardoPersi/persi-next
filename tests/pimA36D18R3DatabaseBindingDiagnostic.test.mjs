// A3.6-D1.8-R3: proof for the temporary staging-only diagnostic route
// (app/api/internal/staging/database-binding/route.ts) that resolves
// STAGING_DATABASE_BINDING without ever touching Hostinger or a real
// staging process. Two layers, matching this repo's established
// convention for route.ts files (see checkoutPaymentHealth.test.mjs,
// tests covering app/api/internal/catalog-sync/*):
//
//   1. Behavioral unit tests of the pure classification/check functions
//      the route wires together (classifyDatabaseBinding/checkDatabaseBinding)
//      -- these carry the actual MATCH/WRONG/UNKNOWN logic.
//   2. Source-text structural assertions on route.ts itself, proving the
//      fail-closed ORDER (404 -> 401 -> UNKNOWN-on-failure) and that the
//      response can never carry anything beyond { databaseBinding }.
//
// Route.ts is not dynamically imported: it imports the bare "next/server"
// specifier (correct for the real Next.js build, exactly like every other
// route in this repo), which does not resolve under this project's plain
// Node test loader (confirmed directly -- ERR_MODULE_NOT_FOUND, same
// class of issue already documented and fixed for next/server's after()
// in lib/pim/publication-shadow-runtime.ts, but NOT applied here since
// doing so would make this route's import style inconsistent with every
// other route.ts in the app/api tree for zero production benefit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  checkDatabaseBinding,
  classifyDatabaseBinding,
  EXPECTED_STAGING_PROJECT_REF,
} from "../lib/pim/publication-runtime-preflight.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// ---------- classifyDatabaseBinding: pure mapping logic ----------

test("classifyDatabaseBinding: present + matching project ref => MATCH", () => {
  assert.equal(
    classifyDatabaseBinding({ present: true, projectRef: EXPECTED_STAGING_PROJECT_REF, matchesExpectedStaging: true }),
    "MATCH",
  );
});

test("classifyDatabaseBinding: present + different project ref => WRONG", () => {
  assert.equal(
    classifyDatabaseBinding({ present: true, projectRef: "some-other-project-ref", matchesExpectedStaging: false }),
    "WRONG",
  );
});

test("classifyDatabaseBinding: not present at all => UNKNOWN", () => {
  assert.equal(classifyDatabaseBinding({ present: false, projectRef: null, matchesExpectedStaging: false }), "UNKNOWN");
});

test("classifyDatabaseBinding: present but unparseable (indeterminate) => UNKNOWN, never MATCH by default", () => {
  assert.equal(classifyDatabaseBinding({ present: true, projectRef: null, matchesExpectedStaging: false }), "UNKNOWN");
});

// ---------- checkDatabaseBinding + classifyDatabaseBinding together ----------
// Fixture connection strings only -- never a real credential, never read
// from any real env var here.

test("end-to-end: correctly bound staging DATABASE_URL fixture classifies as MATCH", () => {
  const fixtureUrl = `postgresql://postgres.${EXPECTED_STAGING_PROJECT_REF}:fixture-password-not-real@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;
  assert.equal(classifyDatabaseBinding(checkDatabaseBinding(fixtureUrl)), "MATCH");
});

test("end-to-end: wrong-project DATABASE_URL fixture classifies as WRONG", () => {
  const fixtureUrl = "postgresql://postgres.someotherprojectref123:fixture-password-not-real@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";
  assert.equal(classifyDatabaseBinding(checkDatabaseBinding(fixtureUrl)), "WRONG");
});

test("end-to-end: missing DATABASE_URL (explicit empty string, not undefined -- undefined would fall back to the real default parameter) classifies as UNKNOWN", () => {
  assert.equal(classifyDatabaseBinding(checkDatabaseBinding("")), "UNKNOWN");
});

test("end-to-end: malformed DATABASE_URL (no postgres.<ref>: segment) classifies as UNKNOWN, never MATCH", () => {
  assert.equal(classifyDatabaseBinding(checkDatabaseBinding("postgresql://malformed-host/db")), "UNKNOWN");
});

test("checkDatabaseBinding/classifyDatabaseBinding perform zero I/O: no fetch, no await, no db-client import in the preflight module", async () => {
  const source = await read("lib/pim/publication-runtime-preflight.ts");
  assert.doesNotMatch(source, /\bfetch\(/);
  assert.doesNotMatch(source, /\bawait\b/);
  assert.doesNotMatch(source, /drizzle|from ["']@\/lib\/db/);
});

// ---------- route.ts: structural / fail-closed-order proof ----------

test("route.ts: reuses the existing runtime/auth/binding functions, does not reimplement any of them", async () => {
  const source = await read("app/api/internal/staging/database-binding/route.ts");
  assert.match(source, /import \{ isStagingRuntime \} from "@\/lib\/runtime\/runtime-environment"/);
  assert.match(source, /import \{ isStagingBasicAuthValid \} from "@\/lib\/runtime\/staging-access-guard"/);
  assert.match(source, /import \{ checkDatabaseBinding, classifyDatabaseBinding \} from "@\/lib\/pim\/publication-runtime-preflight"/);
});

test("route.ts: only GET is exported (no POST/PUT/DELETE/PATCH)", async () => {
  const source = await read("app/api/internal/staging/database-binding/route.ts");
  assert.match(source, /export async function GET\(/);
  assert.doesNotMatch(source, /export (async )?function (POST|PUT|DELETE|PATCH)\(/);
});

test("route.ts: no caching (force-dynamic, revalidate 0)", async () => {
  const source = await read("app/api/internal/staging/database-binding/route.ts");
  assert.match(source, /export const dynamic = "force-dynamic"/);
  assert.match(source, /export const revalidate = 0/);
});

test("route.ts: fail-closed ORDER is runtime check, then auth check, then binding classification", async () => {
  const source = await read("app/api/internal/staging/database-binding/route.ts");
  const runtimeCheckIndex = source.indexOf("if (!isStagingRuntime())");
  const authCheckIndex = source.indexOf("if (!isStagingBasicAuthValid(");
  const classifyIndex = source.indexOf("classifyDatabaseBinding(checkDatabaseBinding())");
  assert.ok(runtimeCheckIndex !== -1 && authCheckIndex !== -1 && classifyIndex !== -1);
  assert.ok(runtimeCheckIndex < authCheckIndex && authCheckIndex < classifyIndex);
});

test("route.ts: wrong runtime returns 404, before any auth or binding logic runs", async () => {
  const source = await read("app/api/internal/staging/database-binding/route.ts");
  const runtimeBlock = source.slice(source.indexOf("if (!isStagingRuntime())"), source.indexOf("if (!isStagingBasicAuthValid("));
  assert.match(runtimeBlock, /status: 404/);
});

test("route.ts: missing/invalid Basic Auth returns 401 with WWW-Authenticate Basic realm", async () => {
  const source = await read("app/api/internal/staging/database-binding/route.ts");
  const authBlock = source.slice(source.indexOf("if (!isStagingBasicAuthValid("), source.indexOf("let databaseBinding"));
  assert.match(authBlock, /status: 401/);
  assert.match(authBlock, /WWW-Authenticate.*Basic realm/);
});

test("route.ts: classification failure is caught and degrades to UNKNOWN, never throws to the client, never defaults to MATCH", async () => {
  const source = await read("app/api/internal/staging/database-binding/route.ts");
  const tryBlock = source.slice(source.indexOf("try {", source.indexOf("let databaseBinding")), source.indexOf("return NextResponse.json({ databaseBinding }"));
  assert.match(tryBlock, /catch \{\s*databaseBinding = "UNKNOWN";\s*\}/);
});

test("route.ts: success response contains only the databaseBinding field, nothing else", async () => {
  const source = await read("app/api/internal/staging/database-binding/route.ts");
  assert.match(source, /return NextResponse\.json\(\{ databaseBinding \}/);
});

function extractResponseBodyLiterals(source) {
  // Every NextResponse.json(<body>, ...) call site's <body> argument text --
  // the only place data can actually cross the HTTP response boundary.
  const bodies = [];
  const regex = /NextResponse\.json\(\s*(\{[^)]*?\})\s*(?:,|\))/gs;
  let match;
  while ((match = regex.exec(source)) !== null) bodies.push(match[1]);
  return bodies;
}

test("route.ts: never puts projectRef or 'present' into an actual response body -- only the 3-value classification crosses the response boundary", async () => {
  const source = await read("app/api/internal/staging/database-binding/route.ts");
  const bodies = extractResponseBodyLiterals(source);
  assert.ok(bodies.length >= 3, "expected at least 3 NextResponse.json(...) call sites (404, 401, success)");
  for (const body of bodies) {
    assert.doesNotMatch(body, /DATABASE_URL/);
    assert.doesNotMatch(body, /projectRef/);
    assert.doesNotMatch(body, /\bpresent\b/);
  }
});

test("route.ts: no response body anywhere contains a password/connection-string-shaped literal", async () => {
  const source = await read("app/api/internal/staging/database-binding/route.ts");
  const bodies = extractResponseBodyLiterals(source);
  for (const body of bodies) {
    assert.doesNotMatch(body, /postgres(?:ql)?:\/\//i);
    assert.doesNotMatch(body, /password/i);
  }
});
