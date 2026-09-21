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

// A connection string that is syntactically valid but structurally
// unreachable (port 1 has no listener) -- same technique already
// established by tests/nativeCommerceAuthority.test.mjs's own
// PLACEHOLDER_DATABASE_URL. Real behavior, real (fast, local, refused)
// network attempt, zero dependency on any live Postgres, zero staging
// traffic.
const UNREACHABLE_DATABASE_URL = "postgresql://placeholder:placeholder@127.0.0.1:1/placeholder";

// ---------- pure decision logic: evaluateIdentityRow ----------

test("evaluateIdentityRow: correct current_user and session_user -> ok=true, stage=ok, both matches true", () => {
  const result = evaluateIdentityRow("persi_app", "persi_app_login", {
    current_user: "persi_app",
    session_user: "persi_app_login",
  });
  assert.deepEqual(result, { ok: true, stage: "ok", currentUserMatch: true, sessionUserMatch: true });
});

test("evaluateIdentityRow: correct current_user + wrong session_user -> identity_mismatch, true/false", () => {
  const result = evaluateIdentityRow("persi_app", "persi_app_login", {
    current_user: "persi_app",
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
  const result = evaluateIdentityRow("persi_app", "persi_app_login", {
    current_user: "postgres",
    session_user: "some_other_login",
  });
  assert.deepEqual(result, { ok: false, stage: "identity_mismatch", currentUserMatch: false, sessionUserMatch: false });
});

test("evaluateIdentityRow: missing row -> connection_or_activation_error, matches null", () => {
  const result = evaluateIdentityRow("persi_app", "persi_app_login", undefined);
  assert.deepEqual(result, { ok: false, stage: "connection_or_activation_error", currentUserMatch: null, sessionUserMatch: null });
});

test("evaluateIdentityRow: worker side, both correct -> ok=true", () => {
  const result = evaluateIdentityRow("persi_worker", "persi_worker_login", {
    current_user: "persi_worker",
    session_user: "persi_worker_login",
  });
  assert.deepEqual(result, { ok: true, stage: "ok", currentUserMatch: true, sessionUserMatch: true });
});

// ---------- checkIdentity: env_missing (real behavior, no DB needed) ----------

test("APP env absent -> stage=env_missing, matches null, without needing a DB", async () => {
  await withEnv({ NATIVE_APP_DATABASE_URL: undefined }, async () => {
    const result = await checkIdentity("persi_app", "NATIVE_APP_DATABASE_URL", "persi_app_login");
    assert.deepEqual(result, { ok: false, stage: "env_missing", currentUserMatch: null, sessionUserMatch: null });
  });
});

test("WORKER env absent -> stage=env_missing, matches null, without needing a DB", async () => {
  await withEnv({ NATIVE_WORKER_DATABASE_URL: undefined }, async () => {
    const result = await checkIdentity("persi_worker", "NATIVE_WORKER_DATABASE_URL", "persi_worker_login");
    assert.deepEqual(result, { ok: false, stage: "env_missing", currentUserMatch: null, sessionUserMatch: null });
  });
});

test("APP env blank string is treated as absent, not a value to connect with", async () => {
  await withEnv({ NATIVE_APP_DATABASE_URL: "   " }, async () => {
    const result = await checkIdentity("persi_app", "NATIVE_APP_DATABASE_URL", "persi_app_login");
    assert.equal(result.stage, "env_missing");
  });
});

test("runNativeCommerceIdentityProbe: both envs absent -> both sides env_missing, correct shape, no DB required", async () => {
  await withEnv({ NATIVE_APP_DATABASE_URL: undefined, NATIVE_WORKER_DATABASE_URL: undefined }, async () => {
    const result = await runNativeCommerceIdentityProbe();
    assert.deepEqual(result, {
      app: { ok: false, stage: "env_missing", currentUserMatch: null, sessionUserMatch: null },
      worker: { ok: false, stage: "env_missing", currentUserMatch: null, sessionUserMatch: null },
    });
  });
});

// ---------- checkIdentity: connection_or_activation_error (real network attempt, no live Postgres needed) ----------

test("APP env present but unreachable -> stage=connection_or_activation_error, matches null, error never surfaced", async () => {
  await withEnv({ NATIVE_APP_DATABASE_URL: UNREACHABLE_DATABASE_URL }, async () => {
    const result = await checkIdentity("persi_app", "NATIVE_APP_DATABASE_URL", "persi_app_login");
    assert.deepEqual(result, { ok: false, stage: "connection_or_activation_error", currentUserMatch: null, sessionUserMatch: null });
  });
});

test("WORKER env present but unreachable -> stage=connection_or_activation_error, matches null, error never surfaced", async () => {
  await withEnv({ NATIVE_WORKER_DATABASE_URL: UNREACHABLE_DATABASE_URL }, async () => {
    const result = await checkIdentity("persi_worker", "NATIVE_WORKER_DATABASE_URL", "persi_worker_login");
    assert.deepEqual(result, { ok: false, stage: "connection_or_activation_error", currentUserMatch: null, sessionUserMatch: null });
  });
});

// ---------- helper module source assertions ----------

const helperSource = readFileSync("lib/runtime/native-commerce-identity-probe.ts", "utf8");

test("uses the real production withPersiRole from lib/db/nativeCommerceAuthority, not a parallel implementation", () => {
  assert.match(helperSource, /import \{ withPersiRole, type PersiRole \} from "@\/lib\/db\/nativeCommerceAuthority";/);
  // "the only SQL executed..." test below already proves the single sql`...`
  // template in this file is the fixed identity query, not a SET LOCAL ROLE
  // statement -- structurally proving this module never activates a role
  // itself, only through withPersiRole.
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

test("only the four allowed stage values exist in the module", () => {
  assert.match(helperSource, /export type ProbeStage = "ok" \| "env_missing" \| "connection_or_activation_error" \| "identity_mismatch";/);
  const stageLiterals = [...helperSource.matchAll(/stage: "([a-z_]+)"/g)].map((m) => m[1]);
  const allowed = new Set(["ok", "env_missing", "connection_or_activation_error", "identity_mismatch"]);
  for (const literal of stageLiterals) {
    assert.ok(allowed.has(literal), `unexpected stage literal used in source: ${literal}`);
  }
});

test("activatedAs field no longer exists as code -- replaced by stage/currentUserMatch/sessionUserMatch (mentioned only in an explanatory comment)", () => {
  // The word appears exactly once, inside the file-level rationale comment
  // explaining the R2 change -- never as an object property or type field.
  const occurrences = helperSource.match(/activatedAs/g) ?? [];
  assert.equal(occurrences.length, 1);
  assert.doesNotMatch(helperSource, /activatedAs:/, "must not appear as an object property/type field anywhere");
});

test("no raw driver/Postgres error is ever placed on the result -- catch block returns only the fixed classification", () => {
  const fnBody = helperSource.slice(helperSource.indexOf("export async function checkIdentity"));
  const catchBlock = fnBody.slice(fnBody.indexOf("} catch"));
  assert.doesNotMatch(catchBlock, /error\.message|err\.message|String\(error\)|String\(err\)|error\.code|err\.code/);
  assert.match(catchBlock, /stage: "connection_or_activation_error"/);
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

test("success response body contains only {ok, stage, currentUserMatch, sessionUserMatch} per side -- no raw identity, no activatedAs", () => {
  const jsonCallIndex = routeSource.indexOf("NextResponse.json(");
  const jsonCallBlock = routeSource.slice(jsonCallIndex, routeSource.indexOf(");", jsonCallIndex));
  assert.match(jsonCallBlock, /app: \{ ok: app\.ok, stage: app\.stage, currentUserMatch: app\.currentUserMatch, sessionUserMatch: app\.sessionUserMatch \}/);
  assert.match(jsonCallBlock, /worker: \{ ok: worker\.ok, stage: worker\.stage, currentUserMatch: worker\.currentUserMatch, sessionUserMatch: worker\.sessionUserMatch \}/);
  assert.doesNotMatch(jsonCallBlock, /activatedAs/);
  assert.doesNotMatch(jsonCallBlock, /DATABASE_URL|password|connectionString/i);
});

test("no secret-shaped literal (connection string, password assignment) appears in either file", () => {
  for (const source of [routeSource, helperSource]) {
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
