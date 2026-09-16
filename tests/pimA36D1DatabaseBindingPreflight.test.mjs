import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDatabaseBinding, EXPECTED_STAGING_PROJECT_REF } from "../lib/pim/publication-runtime-preflight.ts";

test("checkDatabaseBinding: missing DATABASE_URL reports present=false, no throw", () => {
  // NOTE: passing an explicit "" here, not `undefined` -- `undefined` would
  // trigger the function's own default parameter (process.env.DATABASE_URL),
  // which IS set in this dev/test process (pointing at real staging). An
  // empty string is the correct way to simulate "the variable is unset" for
  // this test without relying on ambient process.env state.
  const result = checkDatabaseBinding("");
  assert.equal(result.present, false);
  assert.equal(result.projectRef, null);
  assert.equal(result.matchesExpectedStaging, false);
});

test("checkDatabaseBinding: a staging-shaped connection string matches", () => {
  const fakeStagingUrl = `postgresql://postgres.${EXPECTED_STAGING_PROJECT_REF}:SOME_PASSWORD@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;
  const result = checkDatabaseBinding(fakeStagingUrl);
  assert.equal(result.present, true);
  assert.equal(result.projectRef, EXPECTED_STAGING_PROJECT_REF);
  assert.equal(result.matchesExpectedStaging, true);
});

test("checkDatabaseBinding: a DIFFERENT project ref (e.g. a hypothetical production ref) is correctly flagged as NOT matching staging", () => {
  const fakeOtherUrl = "postgresql://postgres.someotherprojectref:SOME_PASSWORD@aws-0-sa-east-1.pooler.supabase.com:5432/postgres";
  const result = checkDatabaseBinding(fakeOtherUrl);
  assert.equal(result.matchesExpectedStaging, false);
  assert.notEqual(result.projectRef, EXPECTED_STAGING_PROJECT_REF);
});

test("checkDatabaseBinding: the result never contains the password substring from the input connection string", () => {
  const fakeUrl = `postgresql://postgres.${EXPECTED_STAGING_PROJECT_REF}:MY_SECRET_PASSWORD_VALUE@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;
  const result = checkDatabaseBinding(fakeUrl);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /MY_SECRET_PASSWORD_VALUE/);
});
