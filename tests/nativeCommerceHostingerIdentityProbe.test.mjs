import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateIdentityRow,
  checkIdentity,
  evaluateAppBareConnection,
  evaluateAppRoleActivation,
  checkAppIdentityDetailed,
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

// A connection string that is syntactically valid but structurally
// unreachable (port 1 has no listener) -- same technique already
// established by tests/nativeCommerceAuthority.test.mjs's own
// PLACEHOLDER_DATABASE_URL. Real behavior, real (fast, local, refused)
// network attempt, zero dependency on any live Postgres, zero staging
// traffic.
const UNREACHABLE_DATABASE_URL = "postgresql://placeholder:placeholder@127.0.0.1:1/placeholder";

// ================== WORKER: unchanged control path (R2) ==================

test("evaluateIdentityRow: correct current_user and session_user -> ok=true, stage=ok, both matches true", () => {
  const result = evaluateIdentityRow("persi_worker", "persi_worker_login", {
    current_user: "persi_worker",
    session_user: "persi_worker_login",
  });
  assert.deepEqual(result, { ok: true, stage: "ok", currentUserMatch: true, sessionUserMatch: true });
});

test("evaluateIdentityRow: correct current_user + wrong session_user -> identity_mismatch, true/false", () => {
  const result = evaluateIdentityRow("persi_worker", "persi_worker_login", {
    current_user: "persi_worker",
    session_user: "some_other_login",
  });
  assert.deepEqual(result, { ok: false, stage: "identity_mismatch", currentUserMatch: true, sessionUserMatch: false });
});

test("evaluateIdentityRow: wrong current_user + correct session_user -> identity_mismatch, false/true", () => {
  const result = evaluateIdentityRow("persi_worker", "persi_worker_login", {
    current_user: "postgres",
    session_user: "persi_worker_login",
  });
  assert.deepEqual(result, { ok: false, stage: "identity_mismatch", currentUserMatch: false, sessionUserMatch: true });
});

test("evaluateIdentityRow: both wrong -> identity_mismatch, false/false", () => {
  const result = evaluateIdentityRow("persi_worker", "persi_worker_login", {
    current_user: "postgres",
    session_user: "some_other_login",
  });
  assert.deepEqual(result, { ok: false, stage: "identity_mismatch", currentUserMatch: false, sessionUserMatch: false });
});

test("evaluateIdentityRow: missing row -> connection_or_activation_error, matches null", () => {
  const result = evaluateIdentityRow("persi_worker", "persi_worker_login", undefined);
  assert.deepEqual(result, { ok: false, stage: "connection_or_activation_error", currentUserMatch: null, sessionUserMatch: null });
});

test("WORKER env absent -> stage=env_missing, matches null, without needing a DB", async () => {
  await withEnv({ NATIVE_WORKER_DATABASE_URL: undefined }, async () => {
    const result = await checkIdentity("persi_worker", "NATIVE_WORKER_DATABASE_URL", "persi_worker_login");
    assert.deepEqual(result, { ok: false, stage: "env_missing", currentUserMatch: null, sessionUserMatch: null });
  });
});

test("WORKER env present but unreachable -> stage=connection_or_activation_error, matches null, error never surfaced", async () => {
  await withEnv({ NATIVE_WORKER_DATABASE_URL: UNREACHABLE_DATABASE_URL }, async () => {
    const result = await checkIdentity("persi_worker", "NATIVE_WORKER_DATABASE_URL", "persi_worker_login");
    assert.deepEqual(result, { ok: false, stage: "connection_or_activation_error", currentUserMatch: null, sessionUserMatch: null });
  });
});

// ================== APP: R3 two-step connection/activation isolation ==================

// ---- STEP 1 pure logic: evaluateAppBareConnection ----

test("APP STEP1: correct bare login identity -> proceed=true", () => {
  const outcome = evaluateAppBareConnection({ current_user: "persi_app_login", session_user: "persi_app_login" });
  assert.deepEqual(outcome, { proceed: true });
});

test("APP STEP1: no row (connection/query failed) -> connection_error", () => {
  const outcome = evaluateAppBareConnection(undefined);
  assert.deepEqual(outcome, {
    proceed: false,
    result: { ok: false, stage: "connection_error", loginIdentityMatch: null, roleActivationMatch: null },
  });
});

test("APP STEP1: connected but wrong current_user -> login_identity_mismatch", () => {
  const outcome = evaluateAppBareConnection({ current_user: "postgres", session_user: "persi_app_login" });
  assert.deepEqual(outcome, {
    proceed: false,
    result: { ok: false, stage: "login_identity_mismatch", loginIdentityMatch: false, roleActivationMatch: null },
  });
});

test("APP STEP1: connected but wrong session_user -> login_identity_mismatch", () => {
  const outcome = evaluateAppBareConnection({ current_user: "persi_app_login", session_user: "some_other_login" });
  assert.deepEqual(outcome, {
    proceed: false,
    result: { ok: false, stage: "login_identity_mismatch", loginIdentityMatch: false, roleActivationMatch: null },
  });
});

// ---- STEP 2 pure logic: evaluateAppRoleActivation (only reached after STEP 1 passes) ----

test("APP STEP2: no row (activation/query failed) -> role_activation_error", () => {
  const result = evaluateAppRoleActivation(undefined);
  assert.deepEqual(result, { ok: false, stage: "role_activation_error", loginIdentityMatch: true, roleActivationMatch: null });
});

test("APP STEP2: activated but wrong current_user -> role_identity_mismatch", () => {
  const result = evaluateAppRoleActivation({ current_user: "persi_app_login", session_user: "persi_app_login" });
  assert.deepEqual(result, { ok: false, stage: "role_identity_mismatch", loginIdentityMatch: true, roleActivationMatch: false });
});

test("APP STEP2: activated but wrong session_user -> role_identity_mismatch", () => {
  const result = evaluateAppRoleActivation({ current_user: "persi_app", session_user: "some_other_login" });
  assert.deepEqual(result, { ok: false, stage: "role_identity_mismatch", loginIdentityMatch: true, roleActivationMatch: false });
});

test("APP STEP2: both correct -> ok=true, stage=ok", () => {
  const result = evaluateAppRoleActivation({ current_user: "persi_app", session_user: "persi_app_login" });
  assert.deepEqual(result, { ok: true, stage: "ok", loginIdentityMatch: true, roleActivationMatch: true });
});

// ---- checkAppIdentityDetailed: real behavior, no live Postgres needed ----

test("APP env absent -> stage=env_missing, without needing a DB", async () => {
  await withEnv({ NATIVE_APP_DATABASE_URL: undefined }, async () => {
    const result = await checkAppIdentityDetailed();
    assert.deepEqual(result, { ok: false, stage: "env_missing", loginIdentityMatch: null, roleActivationMatch: null });
  });
});

test("APP env blank string is treated as absent, not a value to connect with", async () => {
  await withEnv({ NATIVE_APP_DATABASE_URL: "   " }, async () => {
    const result = await checkAppIdentityDetailed();
    assert.equal(result.stage, "env_missing");
  });
});

test("APP env present but unreachable -> STEP1 fails first -> stage=connection_error (not role_activation_error)", async () => {
  await withEnv({ NATIVE_APP_DATABASE_URL: UNREACHABLE_DATABASE_URL }, async () => {
    const result = await checkAppIdentityDetailed();
    assert.deepEqual(result, { ok: false, stage: "connection_error", loginIdentityMatch: null, roleActivationMatch: null });
  });
});

test("runNativeCommerceIdentityProbe: both envs absent -> app env_missing, worker env_missing, correct shape, no DB required", async () => {
  await withEnv({ NATIVE_APP_DATABASE_URL: undefined, NATIVE_WORKER_DATABASE_URL: undefined }, async () => {
    const result = await runNativeCommerceIdentityProbe();
    assert.deepEqual(result, {
      app: { ok: false, stage: "env_missing", loginIdentityMatch: null, roleActivationMatch: null },
      worker: { ok: false, stage: "env_missing", currentUserMatch: null, sessionUserMatch: null },
    });
  });
});

// ---------- helper module source assertions ----------

const helperSource = readFileSync("lib/runtime/native-commerce-identity-probe.ts", "utf8");

test("uses the real production withPersiRole and getPersiRolePoolForDiagnostics from lib/db/nativeCommerceAuthority, not a parallel implementation", () => {
  assert.match(helperSource, /import \{ getPersiRolePoolForDiagnostics, withPersiRole, type PersiRole \} from "@\/lib\/db\/nativeCommerceAuthority";/);
});

test("STEP1 (bare connection) never goes through withPersiRole -- only STEP2 (role activation) does", () => {
  const fnBody = helperSource.slice(helperSource.indexOf("export async function checkAppIdentityDetailed"));
  const bareDbCallIndex = fnBody.indexOf("getPersiRolePoolForDiagnostics(APP_ROLE)");
  const step1EvalIndex = fnBody.indexOf("evaluateAppBareConnection(bareRow)");
  const withPersiRoleCallIndex = fnBody.indexOf("withPersiRole(APP_ROLE");
  assert.ok(bareDbCallIndex > -1 && step1EvalIndex > -1 && withPersiRoleCallIndex > -1);
  assert.ok(bareDbCallIndex < step1EvalIndex, "bare connection must be obtained before STEP1 evaluation");
  assert.ok(step1EvalIndex < withPersiRoleCallIndex, "STEP1 must be evaluated before STEP2's withPersiRole call");
});

test("env presence is checked before any connection/pool access, for both APP and WORKER", () => {
  const appFnBody = helperSource.slice(helperSource.indexOf("export async function checkAppIdentityDetailed"));
  const appPresenceCheckIndex = appFnBody.indexOf("process.env.NATIVE_APP_DATABASE_URL");
  const appPoolCallIndex = appFnBody.indexOf("getPersiRolePoolForDiagnostics");
  assert.ok(appPresenceCheckIndex > -1 && appPoolCallIndex > -1 && appPresenceCheckIndex < appPoolCallIndex);

  const workerFnBody = helperSource.slice(helperSource.indexOf("export async function checkIdentity"));
  const workerPresenceCheckIndex = workerFnBody.indexOf("process.env[envVarName]");
  const workerWithPersiRoleIndex = workerFnBody.indexOf("withPersiRole(role");
  assert.ok(workerPresenceCheckIndex > -1 && workerWithPersiRoleIndex > -1 && workerPresenceCheckIndex < workerWithPersiRoleIndex);
});

test("the only SQL executed anywhere in the module is the fixed identity query, defined once and reused", () => {
  const sqlOccurrences = helperSource.match(/sql`[^`]*`/g) ?? [];
  assert.equal(sqlOccurrences.length, 1);
  assert.match(sqlOccurrences[0], /^sql`select current_user, session_user`$/);
  // Reused by reference (IDENTITY_QUERY), not re-templated, at all 3 call sites.
  const referenceCount = (helperSource.match(/\bIDENTITY_QUERY\b/g) ?? []).length;
  assert.ok(referenceCount >= 4, "expected 1 definition + at least 3 usages");
});

test("only the six allowed APP stage values and four allowed WORKER stage values exist in the module", () => {
  assert.match(
    helperSource,
    /export type AppProbeStage =\s*\|\s*"ok"\s*\|\s*"env_missing"\s*\|\s*"connection_error"\s*\|\s*"login_identity_mismatch"\s*\|\s*"role_activation_error"\s*\|\s*"role_identity_mismatch";/,
  );
  assert.match(helperSource, /export type ProbeStage = "ok" \| "env_missing" \| "connection_or_activation_error" \| "identity_mismatch";/);

  const stageLiterals = [...helperSource.matchAll(/stage: "([a-z_]+)"/g)].map((m) => m[1]);
  const allowed = new Set([
    "ok",
    "env_missing",
    "connection_or_activation_error",
    "identity_mismatch",
    "connection_error",
    "login_identity_mismatch",
    "role_activation_error",
    "role_identity_mismatch",
  ]);
  for (const literal of stageLiterals) {
    assert.ok(allowed.has(literal), `unexpected stage literal used in source: ${literal}`);
  }
});

test("no raw driver/Postgres error is ever placed on a result -- every catch block returns only a fixed classification", () => {
  const catchBlocks = helperSource.match(/catch \{[^}]*\}/g) ?? [];
  assert.ok(catchBlocks.length >= 3);
  for (const block of catchBlocks) {
    assert.doesNotMatch(block, /error\.message|err\.message|String\(error\)|String\(err\)|error\.code|err\.code/);
  }
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

// ---------- nativeCommerceAuthority.ts: the new diagnostic export ----------

const authoritySource = readFileSync("lib/db/nativeCommerceAuthority.ts", "utf8");

test("getPersiRolePoolForDiagnostics reuses getRolePool exactly -- no parallel connection construction", () => {
  assert.match(authoritySource, /export function getPersiRolePoolForDiagnostics\(role: PersiRole\): PostgresJsDatabase<typeof schema> \| null \{/);
  const fnBody = authoritySource.slice(authoritySource.indexOf("export function getPersiRolePoolForDiagnostics"));
  const firstBraceClose = fnBody.indexOf("\n}");
  const body = fnBody.slice(0, firstBraceClose);
  assert.match(body, /getRolePool\(role\)/);
  assert.doesNotMatch(body, /new postgres\(|drizzle\(/, "must not construct a new client/pool -- only read the existing cached one via getRolePool");
});

test("getPersiRolePoolForDiagnostics never opens a transaction or activates a role", () => {
  const fnBody = authoritySource.slice(
    authoritySource.indexOf("export function getPersiRolePoolForDiagnostics"),
    authoritySource.indexOf("export async function closeNativeCommerceAuthorityForTests"),
  );
  assert.doesNotMatch(fnBody, /\.transaction\(|activationStatement/);
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

test("staging guard runs before the Basic Auth check, which runs before the DB probe (production/undefined -> 404, invalid auth -> denied, both before DB)", () => {
  const getBody = routeSource.slice(routeSource.indexOf("export async function GET"));
  const stagingGateIndex = getBody.indexOf("isStagingRuntime()");
  const authGateIndex = getBody.indexOf("isStagingBasicAuthValid(");
  const probeCallIndex = getBody.indexOf("runNativeCommerceIdentityProbe()");
  assert.ok(stagingGateIndex > -1 && authGateIndex > -1 && probeCallIndex > -1);
  assert.ok(stagingGateIndex < authGateIndex, "staging runtime guard must run before the Basic Auth check");
  assert.ok(authGateIndex < probeCallIndex, "Basic Auth check must run before the database probe");
});

test("staging guard returns 404, auth guard returns 401, both before any DB call", () => {
  const getBody = routeSource.slice(routeSource.indexOf("export async function GET"));
  const stagingGateBlock = getBody.slice(getBody.indexOf("isStagingRuntime()"), getBody.indexOf("isStagingBasicAuthValid("));
  assert.match(stagingGateBlock, /status: 404/);
  assert.match(routeSource, /function unauthorizedResponse[\s\S]*?status: 401/);
});

test("reuses the existing staging Basic Auth helpers verbatim -- no local password/credential comparison", () => {
  assert.match(routeSource, /import \{ isStagingBasicAuthValid \} from "@\/lib\/runtime\/staging-access-guard";/);
  assert.doesNotMatch(routeSource, /timingSafeEqual|PERSI_STAGING_BASIC_AUTH/, "must not reimplement the credential comparison locally");
});

test("every response sets Cache-Control: no-store", () => {
  assert.match(routeSource, /const NO_STORE_HEADERS = \{ "Cache-Control": "no-store" \}/);
  assert.match(routeSource, /headers: NO_STORE_HEADERS/);
  assert.match(routeSource, /\.\.\.NO_STORE_HEADERS/);
});

test("success response body: app has {ok, stage, loginIdentityMatch, roleActivationMatch}, worker has {ok, stage, currentUserMatch, sessionUserMatch} -- no raw identity", () => {
  const jsonCallIndex = routeSource.indexOf("NextResponse.json(");
  const jsonCallBlock = routeSource.slice(jsonCallIndex, routeSource.indexOf(");", jsonCallIndex));
  assert.match(jsonCallBlock, /app: \{ ok: app\.ok, stage: app\.stage, loginIdentityMatch: app\.loginIdentityMatch, roleActivationMatch: app\.roleActivationMatch \}/);
  assert.match(jsonCallBlock, /worker: \{ ok: worker\.ok, stage: worker\.stage, currentUserMatch: worker\.currentUserMatch, sessionUserMatch: worker\.sessionUserMatch \}/);
  assert.doesNotMatch(jsonCallBlock, /activatedAs/);
  assert.doesNotMatch(jsonCallBlock, /DATABASE_URL|password|connectionString/i);
});

test("no secret-shaped literal (connection string, password assignment) appears in any of the three files", () => {
  for (const source of [routeSource, helperSource, authoritySource]) {
    assert.doesNotMatch(source, /postgresql:\/\//);
    assert.doesNotMatch(source, /password\s*[:=]\s*["'][^"']+["']/i);
  }
});

test("no commercial/business function or provider name is referenced anywhere in the route file either", () => {
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
