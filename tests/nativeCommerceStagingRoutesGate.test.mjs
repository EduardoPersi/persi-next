import assert from "node:assert/strict";
import test from "node:test";
import { isNativeCommerceStagingRoutesEnabled } from "../lib/runtime/native-commerce-staging-routes.ts";

test("staging + flag=true -> enabled", () => {
  assert.equal(
    isNativeCommerceStagingRoutesEnabled({ PERSI_RUNTIME_ENV: "staging", NATIVE_COMMERCE_STAGING_ROUTES_ENABLED: "true" }),
    true,
  );
});

test("production + flag=true -> STILL disabled (mandatory test from the task)", () => {
  assert.equal(
    isNativeCommerceStagingRoutesEnabled({ PERSI_RUNTIME_ENV: "production", NATIVE_COMMERCE_STAGING_ROUTES_ENABLED: "true" }),
    false,
  );
});

test("missing PERSI_RUNTIME_ENV (today's real production) + flag=true -> disabled", () => {
  assert.equal(isNativeCommerceStagingRoutesEnabled({ NATIVE_COMMERCE_STAGING_ROUTES_ENABLED: "true" }), false);
});

test("staging + flag missing -> disabled", () => {
  assert.equal(isNativeCommerceStagingRoutesEnabled({ PERSI_RUNTIME_ENV: "staging" }), false);
});

test("staging + flag=false -> disabled", () => {
  assert.equal(
    isNativeCommerceStagingRoutesEnabled({ PERSI_RUNTIME_ENV: "staging", NATIVE_COMMERCE_STAGING_ROUTES_ENABLED: "false" }),
    false,
  );
});

test("staging + flag with wrong case/whitespace -> disabled (exact 'true' only)", () => {
  assert.equal(
    isNativeCommerceStagingRoutesEnabled({ PERSI_RUNTIME_ENV: "staging", NATIVE_COMMERCE_STAGING_ROUTES_ENABLED: "TRUE" }),
    false,
  );
  assert.equal(
    isNativeCommerceStagingRoutesEnabled({ PERSI_RUNTIME_ENV: "staging", NATIVE_COMMERCE_STAGING_ROUTES_ENABLED: " true " }),
    true,
    "surrounding whitespace is trimmed before comparison",
  );
});

test("development + flag=true -> disabled (only staging qualifies)", () => {
  assert.equal(
    isNativeCommerceStagingRoutesEnabled({ PERSI_RUNTIME_ENV: "development", NATIVE_COMMERCE_STAGING_ROUTES_ENABLED: "true" }),
    false,
  );
});
