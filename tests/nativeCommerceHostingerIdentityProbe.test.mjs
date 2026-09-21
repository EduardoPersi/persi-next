import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateIdentityRow,
  checkIdentity,
  runNativeCommerceIdentityProbe,
} from "../lib/runtime/native-commerce-identity-probe.ts";

// ---------- helpers ----------

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

// ---------- pure decision logic: evaluateIdentityRow (case 7, 8, 9) ----------

test("evaluateIdentityRow: correct current_user and session_user -> ok=true", () => {
  const result = evaluateIdentityRow("persi_app", "persi_app_login", {
    current_user: "persi_app",
    session_user: "persi_app_login",
  });
  assert.deepEqual(result, { ok: true, activatedAs: "persi_app" });
});

test("evaluateIdentityRow: wrong current_user -> ok=false (case 7)", () => {
  const result = evaluateIdentityRow("persi_app", "persi_app_login", {
    current_user: "postgres",
    session_user: "persi_app_login",
  });
  assert.equal(result.ok, false);
  assert.equal(result.activatedAs, "persi_app");
});

test("evaluateIdentityRow: wrong session_user -> ok=false even if current_user matches (case 8)", () => {
  const result = evaluateIdentityRow("persi_worker", "persi_worker_login", {
    current_user: "persi_worker",
    session_user: "persi_app_login",
  });
  assert.equal(result.ok, false);
});

test("evaluateIdentityRow: missing row -> ok=false", () => {
  const result = evaluateIdentityRow("persi_app", "persi_app_login", undefined);
  assert.equal(result.ok, false);
});

test("evaluateIdentityRow: both worker fields correct -> ok=true (case 9, worker side)", () => {
  const result = evaluateIdentityRow("persi_worker", "persi_worker_login", {
    current_user: "persi_worker",
    session_user: "persi_worker_login",
  });
  assert.deepEqual(result, { ok: true, activatedAs: "persi_worker" });
});

// ---------- fallback-as-failure: env presence gate (case 5, 6) ----------
// No live Postgres is reachable from this test environment, and none is
// needed: checkIdentity returns before ever calling withPersiRole when its
// env var is absent, so this is real behavior, not a mock.

test("APP env absent -> checkIdentity returns ok=false without needing a DB (case 5)", async () => {
  await withEnv({ NATIVE_APP_DATABASE_URL: undefined }, async () => {
    const result = await checkIdentity("persi_app", "NATIVE_APP_DATABASE_URL", "persi_app_login");
    assert.deepEqual(result, { ok: false, activatedAs: "persi_app" });
  });
});

test("WORKER env absent -> checkIdentity returns ok=false without needing a DB (case 6)", async () => {
  await withEnv({ NATIVE_WORKER_DATABASE_URL: undefined }, async () => {
    const result = await checkIdentity("persi_worker", "NATIVE_WORKER_DATABASE_URL", "persi_worker_login");
    assert.deepEqual(result, { ok: false, activatedAs: "persi_worker" });
  });
});

test("APP env blank string is treated as absent, not a value to connect with", async () => {
  await withEnv({ NATIVE_APP_DATABASE_URL: "   " }, async () => {
    const result = await checkIdentity("persi_app", "NATIVE_APP_DATABASE_URL", "persi_app_login");
    assert.equal(result.ok, false);
  });
});

test("runNativeCommerceIdentityProbe: both envs absent -> both sides fail, correct shape, no DB required", async () => {
  await withEnv({ NATIVE_APP_DATABASE_URL: undefined, NATIVE_WORKER_DATABASE_URL: undefined }, async () => {
    const result = await runNativeCommerceIdentityProbe();
    assert.deepEqual(result, {
      app: { ok: false, activatedAs: "persi_app" },
      worker: { ok: false, activatedAs: "persi_worker" },
    });
  });
});

// ---------- helper module source assertions: proves the REAL withPersiRole is used ----------

const helperSource = readFileSync("lib/runtime/native-commerce-identity-probe.ts", "utf8");

test("uses the real production withPersiRole from lib/db/nativeCommerceAuthority, not a parallel implementation", () => {
  assert.match(helperSource, /import \{ withPersiRole, type PersiRole \} from "@\/lib\/db\/nativeCommerceAuthority";/);
  assert.doesNotMatch(helperSource, /set local role/i, "must never issue SET LOCAL ROLE directly -- that belongs exclusively to withPersiRole");
});

test("env presence is checked before withPersiRole is ever called", () => {
  const fnBody = helperSource.slice(helperSource.indexOf("export async function checkIdentity"));
  const presenceCheckIndex = fnBody.indexOf("process.env[envVarName]");
  const withPersiRoleCallIndex = fnBody.indexOf("withPersiRole(role");
  assert.ok(presenceCheckIndex > -1 && withPersiRoleCallIndex > presenceCheckIndex, "presence check must run before withPersiRole is invoked");
});

test("the only SQL executed is the fixed identity query -- no other query text anywhere in the module", () => {
  const sqlOccurrences = helperSource.match(/sql`[^`]*`/g) ?? [];
  assert.equal(sqlOccurrences.length, 1);
  assert.match(sqlOccurrences[0], /^sql`select current_user, session_user`$/);
});

test("no commercial/business function or provider name is referenced anywhere in the helper module", () => {
  const forbidden = [
    /submitNativeCommerceCheckout/i,
    /createNativeCart/i,
    /transitionNativeOrder/i,
    /reclaimExpired/i,
    /createNativePaymentAttempt/i,
    /mercadopago/i,
    /pagbank/i,
    /banco_?inter/i,
    /woocommerce/i,
    /olist/i,
    /melhor ?envio/i,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(helperSource, pattern);
  }
});

// ---------- route.ts: static source assertions ----------
// Matching this codebase's own established convention (tests/
// nativeCheckoutHttpBoundary.test.mjs, tests/checkoutPaymentHealth.test.mjs):
// importing a route file that pulls in "next/server" fails under the plain
// Node test runner outside Next's own bundler, so these are source-shape
// assertions rather than a live GET(request) call.

const routeSource = readFileSync("app/api/internal/native-commerce-identity-probe/route.ts", "utf8");

test("GET only -- no POST/PUT/PATCH/DELETE exported (case: route contract)", () => {
  assert.match(routeSource, /export async function GET\(/);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.doesNotMatch(routeSource, new RegExp(`export (async )?function ${method}\\(`));
  }
});

test("no query parameter or request body is ever read -- role/SQL/database are fully hardcoded", () => {
  const getBody = routeSource.slice(routeSource.indexOf("export async function GET"));
  assert.doesNotMatch(getBody, /searchParams|\.json\(\)|request\.body|request\.url/);
});

test("staging guard runs before the Basic Auth check, which runs before the DB probe (case 1-4 ordering)", () => {
  const getBody = routeSource.slice(routeSource.indexOf("export async function GET"));
  const stagingGateIndex = getBody.indexOf("isStagingRuntime()");
  const authGateIndex = getBody.indexOf("isStagingBasicAuthValid(");
  const probeCallIndex = getBody.indexOf("runNativeCommerceIdentityProbe()");
  assert.ok(stagingGateIndex > -1 && authGateIndex > -1 && probeCallIndex > -1);
  assert.ok(stagingGateIndex < authGateIndex, "staging runtime guard must run before the Basic Auth check");
  assert.ok(authGateIndex < probeCallIndex, "Basic Auth check must run before the database probe");
});

test("staging guard returns 404, auth guard returns 401, both before any DB call (case 1/2 -> 404, case 3/4 -> 401, no DB touched)", () => {
  const getBody = routeSource.slice(routeSource.indexOf("export async function GET"));
  const stagingGateBlock = getBody.slice(getBody.indexOf("isStagingRuntime()"), getBody.indexOf("isStagingBasicAuthValid("));
  assert.match(stagingGateBlock, /status: 404/);
  assert.match(routeSource, /function unauthorizedResponse[\s\S]*?status: 401/);
});

test("reuses the existing staging Basic Auth helpers verbatim -- no local password/credential comparison", () => {
  assert.match(routeSource, /import \{ isStagingBasicAuthValid \} from "@\/lib\/runtime\/staging-access-guard";/);
  assert.doesNotMatch(routeSource, /timingSafeEqual|PERSI_STAGING_BASIC_AUTH/, "must not reimplement the credential comparison locally");
});

test("every response sets Cache-Control: no-store (case 11)", () => {
  const noStoreOccurrences = routeSource.match(/no-store/g) ?? [];
  // NO_STORE_HEADERS is spread into all three response paths (404, 401, 200).
  assert.ok(noStoreOccurrences.length >= 1);
  assert.match(routeSource, /const NO_STORE_HEADERS = \{ "Cache-Control": "no-store" \}/);
  assert.match(routeSource, /headers: NO_STORE_HEADERS/);
  assert.match(routeSource, /\.\.\.NO_STORE_HEADERS/);
});

test("success response body contains only {ok, activatedAs} per side -- no session_user, no raw row (case 10)", () => {
  const jsonCallIndex = routeSource.indexOf("NextResponse.json(");
  const jsonCallBlock = routeSource.slice(jsonCallIndex, routeSource.indexOf(");", jsonCallIndex));
  assert.match(jsonCallBlock, /app: \{ ok: app\.ok, activatedAs: app\.activatedAs \}/);
  assert.match(jsonCallBlock, /worker: \{ ok: worker\.ok, activatedAs: worker\.activatedAs \}/);
  assert.doesNotMatch(jsonCallBlock, /session_user|DATABASE_URL|password|connectionString/i);
});

test("no secret-shaped literal (connection string, password assignment) appears in either file", () => {
  for (const source of [routeSource, helperSource]) {
    assert.doesNotMatch(source, /postgresql:\/\//);
    assert.doesNotMatch(source, /password\s*[:=]\s*["'][^"']+["']/i);
  }
});

test("no commercial/business function or provider name is referenced anywhere in the route file either (case 12)", () => {
  const forbidden = [
    /submitNativeCommerceCheckout/i,
    /createNativeCart/i,
    /transitionNativeOrder/i,
    /reclaimExpired/i,
    /mercadopago/i,
    /pagbank/i,
    /banco_?inter/i,
    /woocommerce/i,
    /olist/i,
    /melhor ?envio/i,
    /isNativeCheckoutRuntimeEnabled/i,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(routeSource, pattern);
  }
});

test("route file is explicitly documented as a temporary, removable probe", () => {
  assert.match(routeSource, /TEMPORARY_STAGING_PROBE=YES/);
  assert.match(helperSource, /TEMPORARY_STAGING_PROBE=YES/);
});
