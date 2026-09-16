// A3.6-D1.6: runtime identity, safety policy, and production-regression
// matrix. All offline, no real DB, no AI provider, no environment variable
// changed in any real environment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getPersiRuntimeEnvironment, isProductionRuntime, isStagingRuntime, isDevelopmentRuntime } from "../lib/runtime/runtime-environment.ts";
import { getRuntimeSafetyPolicy } from "../lib/runtime/runtime-safety-policy.ts";
import { getRuntimeSafetyStatus } from "../lib/runtime/runtime-safety-status.ts";

// ---------- Section 32: staging policy test matrix ----------

test("runtime identity: PERSI_RUNTIME_ENV=staging => staging", () => {
  assert.equal(getPersiRuntimeEnvironment({ PERSI_RUNTIME_ENV: "staging" }), "staging");
  assert.equal(isStagingRuntime({ PERSI_RUNTIME_ENV: "staging" }), true);
});

test("runtime identity: PERSI_RUNTIME_ENV=production => production", () => {
  assert.equal(getPersiRuntimeEnvironment({ PERSI_RUNTIME_ENV: "production" }), "production");
  assert.equal(isProductionRuntime({ PERSI_RUNTIME_ENV: "production" }), true);
});

test("runtime identity: missing PERSI_RUNTIME_ENV => production (compatibility default, Section 8)", () => {
  assert.equal(getPersiRuntimeEnvironment({}), "production");
  assert.equal(isProductionRuntime({}), true);
  assert.equal(isStagingRuntime({}), false);
});

test("runtime identity: invalid/unrecognized value => production (fail-safe, never staging by accident)", () => {
  for (const invalid of ["STAGING", " staging", "staging ", "prod", "Production", "yes", ""]) {
    assert.equal(getPersiRuntimeEnvironment({ PERSI_RUNTIME_ENV: invalid }), "production", `value=${JSON.stringify(invalid)}`);
  }
});

test("CRITICAL: NODE_ENV=production does NOT turn staging into production -- runtime identity is independent of NODE_ENV entirely", () => {
  const env = { NODE_ENV: "production", PERSI_RUNTIME_ENV: "staging" };
  assert.equal(getPersiRuntimeEnvironment(env), "staging");
  assert.equal(isStagingRuntime(env), true);
  assert.equal(isProductionRuntime(env), false);
});

test("development and test values are recognized without needing new abstraction", () => {
  assert.equal(getPersiRuntimeEnvironment({ PERSI_RUNTIME_ENV: "development" }), "development");
  assert.equal(isDevelopmentRuntime({ PERSI_RUNTIME_ENV: "development" }), true);
  assert.equal(getPersiRuntimeEnvironment({ PERSI_RUNTIME_ENV: "test" }), "test");
});

// ---------- safety policy matrix ----------

const STAGING_RESTRICTED_FIELDS = [
  "allowExternalWrites", "allowWooMutations", "allowPayments", "allowTransactionalMessaging",
  "allowErpWrites", "allowCheckoutSubmission", "allowShippingWrites", "allowPublicIndexing", "allowProductionAnalytics",
];

test("staging policy: every restricted capability is false by default", () => {
  const policy = getRuntimeSafetyPolicy({ PERSI_RUNTIME_ENV: "staging" });
  for (const field of STAGING_RESTRICTED_FIELDS) assert.equal(policy[field], false, field);
});

test("production policy: every capability remains true -- zero new restriction introduced for production", () => {
  const policy = getRuntimeSafetyPolicy({ PERSI_RUNTIME_ENV: "production" });
  for (const field of STAGING_RESTRICTED_FIELDS) assert.equal(policy[field], true, field);
  assert.equal(policy.allowPimShadow, true);
});

test("missing PERSI_RUNTIME_ENV (today's real production) produces the exact same permissive policy as explicit production", () => {
  const implicit = getRuntimeSafetyPolicy({});
  const explicit = getRuntimeSafetyPolicy({ PERSI_RUNTIME_ENV: "production" });
  assert.deepEqual(implicit, explicit);
});

test("staging + DATABASE_URL matching the expected staging ref => allowPimShadow=true", () => {
  const policy = getRuntimeSafetyPolicy({ PERSI_RUNTIME_ENV: "staging", DATABASE_URL: "postgresql://postgres.vtrujmhhkmvjzfklzxip:x@host:5432/postgres" });
  assert.equal(policy.allowPimShadow, true);
});

test("staging + DATABASE_URL NOT matching the expected staging ref => allowPimShadow=false even though runtime=staging", () => {
  const policy = getRuntimeSafetyPolicy({ PERSI_RUNTIME_ENV: "staging", DATABASE_URL: "postgresql://postgres.someotherref:x@host:5432/postgres" });
  assert.equal(policy.allowPimShadow, false);
});

test("staging + missing DATABASE_URL => allowPimShadow=false", () => {
  // Explicit "" rather than omitting the key: omitting it would let
  // isPimShadowSafeToRun's own default parameter fall back to this dev
  // process's real (and, here, staging-matching) process.env.DATABASE_URL,
  // masking the "missing" case entirely.
  const policy = getRuntimeSafetyPolicy({ PERSI_RUNTIME_ENV: "staging", DATABASE_URL: "" });
  assert.equal(policy.allowPimShadow, false);
});

// ---------- Section 26/27: safe status snapshot ----------

test("getRuntimeSafetyStatus never includes anything secret-shaped", () => {
  const status = getRuntimeSafetyStatus({ PERSI_RUNTIME_ENV: "staging", DATABASE_URL: "postgresql://postgres.vtrujmhhkmvjzfklzxip:MY_SECRET@host:5432/postgres" });
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /MY_SECRET/);
  assert.doesNotMatch(serialized, /postgresql:\/\//);
  assert.equal(status.databaseProjectRef, "vtrujmhhkmvjzfklzxip");
  assert.equal(status.databaseBindingMatches, true);
});

test("getRuntimeSafetyStatus reflects the full staging policy plus binding state", () => {
  const status = getRuntimeSafetyStatus({ PERSI_RUNTIME_ENV: "staging", DATABASE_URL: "postgresql://postgres.wrongref:x@host:5432/postgres" });
  assert.equal(status.runtimeEnvironment, "staging");
  assert.equal(status.externalWritesAllowed, false);
  assert.equal(status.paymentsAllowed, false);
  assert.equal(status.pimShadowAllowed, false); // wrong ref
  assert.equal(status.databaseBindingMatches, false);
});

// ---------- Section 31: production regression ----------

test("production regression: introducing PERSI_RUNTIME_ENV changes nothing when the variable is absent (exact behavioral parity)", () => {
  const policyNoVar = getRuntimeSafetyPolicy({});
  assert.ok(Object.values(policyNoVar).every((v) => v === true || v === "production"));
});
