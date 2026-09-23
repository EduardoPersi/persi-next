import "server-only";

import { getPersiRuntimeEnvironment } from "./runtime-environment";

// Gate 3 — feature flag for the NEW native cart/checkout-preparation routes
// only (create/read/update/remove cart item, prepare checkout, persist PII,
// mark ready). This is INDEPENDENT of isNativeCheckoutRuntimeEnabled()
// (lib/runtime/native-checkout-mode.ts), which continues to gate the final
// submission route (app/api/checkout/native/route.ts) and remains
// hardcoded `false`, untouched by this file.
//
// Fail-closed by construction, same shape as isStagingRuntime()/
// getPersiRuntimeEnvironment(): missing/unrecognized PERSI_RUNTIME_ENV
// resolves to "production", and production can never satisfy this gate
// even if NATIVE_COMMERCE_STAGING_ROUTES_ENABLED is (mis)configured there.
export function isNativeCommerceStagingRoutesEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  const flag = environment.NATIVE_COMMERCE_STAGING_ROUTES_ENABLED?.trim();
  return flag === "true" && getPersiRuntimeEnvironment(environment) === "staging";
}
