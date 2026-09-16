// A3.6-D1.6 Section 34: access-control matrix for the staging Basic Auth
// fallback (lib/runtime/staging-access-guard.ts). No real secret used --
// fixture credentials only, never shared with any real environment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isStagingBasicAuthValid } from "../lib/runtime/staging-access-guard.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function basicHeader(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

const CONFIGURED = { PERSI_STAGING_BASIC_AUTH_USER: "fixture-user", PERSI_STAGING_BASIC_AUTH_PASSWORD: "fixture-password-not-real" };

test("valid credentials => access granted", () => {
  assert.equal(isStagingBasicAuthValid(basicHeader("fixture-user", "fixture-password-not-real"), CONFIGURED), true);
});

test("invalid password => access denied", () => {
  assert.equal(isStagingBasicAuthValid(basicHeader("fixture-user", "wrong"), CONFIGURED), false);
});

test("invalid user => access denied", () => {
  assert.equal(isStagingBasicAuthValid(basicHeader("wrong-user", "fixture-password-not-real"), CONFIGURED), false);
});

test("missing Authorization header => access denied", () => {
  assert.equal(isStagingBasicAuthValid(null, CONFIGURED), false);
});

test("malformed Authorization header (not Basic scheme) => access denied, no throw", () => {
  assert.doesNotThrow(() => {
    assert.equal(isStagingBasicAuthValid("Bearer sometoken", CONFIGURED), false);
  });
});

test("malformed base64 payload => access denied, no throw", () => {
  assert.doesNotThrow(() => {
    assert.equal(isStagingBasicAuthValid("Basic %%%not-base64%%%", CONFIGURED), false);
  });
});

test("FAIL-CLOSED: credentials not configured at all => access denied even with a header that would otherwise match a hardcoded default", () => {
  assert.equal(isStagingBasicAuthValid(basicHeader("admin", "admin"), {}), false);
  assert.equal(isStagingBasicAuthValid(basicHeader("", ""), {}), false);
});

test("no default/hardcoded credential exists anywhere in the guard's source", async () => {
  const source = await read("lib/runtime/staging-access-guard.ts");
  assert.doesNotMatch(source, /"admin"|"password"|"staging123"|"changeme"/i);
});

// ---------- proxy.ts wiring ----------

test("proxy.ts: staging access check runs before the admin/account logic, gated by isStagingRuntime()", async () => {
  const source = await read("proxy.ts");
  const proxyFnIndex = source.indexOf("export async function proxy(request: NextRequest) {");
  const stagingCheckIndex = source.indexOf("isStagingRuntime()", proxyFnIndex);
  const adminCheckIndex = source.indexOf('pathname === "/admin"', proxyFnIndex);
  assert.ok(stagingCheckIndex !== -1 && adminCheckIndex !== -1 && stagingCheckIndex < adminCheckIndex);
});

test("proxy.ts: staging access denial returns 401 with a WWW-Authenticate Basic header, never leaks credential config", async () => {
  const source = await read("proxy.ts");
  assert.match(source, /status: 401/);
  assert.match(source, /WWW-Authenticate.*Basic realm/);
});

test("proxy.ts: the staging access branch is skipped entirely for production (isStagingRuntime() false by default -- verified at the policy layer in runtimeSafetyGates.test.mjs)", async () => {
  const source = await read("proxy.ts");
  const fn = source.slice(source.indexOf("export async function proxy"));
  const ifBlock = fn.slice(0, fn.indexOf("if (pathname ==="));
  assert.match(ifBlock, /if \(isStagingRuntime\(\)\) \{/);
});

test("proxy.ts matcher still explicitly covers /admin/:path* (documented defense-in-depth, existing test tests/pimAdminSecurity.test.mjs)", async () => {
  const source = await read("proxy.ts");
  assert.match(source, /\/admin\/:path\*/);
});
