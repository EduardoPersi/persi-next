import "server-only";
import { getPersiRuntimeEnvironment } from "@/lib/runtime/runtime-environment";
import { getRuntimeSafetyPolicy } from "@/lib/runtime/runtime-safety-policy";
import { checkDatabaseBinding } from "@/lib/pim/publication-runtime-preflight";

// A3.6-D1.6 Section 26: a safe, non-secret diagnostic snapshot for startup
// logs and tests. Never includes credentials, URLs, or tokens -- only the
// project ref (already non-secret, see publication-runtime-preflight.ts)
// and booleans.
export interface RuntimeSafetyStatus {
  runtimeEnvironment: ReturnType<typeof getPersiRuntimeEnvironment>;
  externalWritesAllowed: boolean;
  paymentsAllowed: boolean;
  wooMutationsAllowed: boolean;
  checkoutSubmissionAllowed: boolean;
  transactionalMessagingAllowed: boolean;
  erpWritesAllowed: boolean;
  shippingWritesAllowed: boolean;
  publicIndexingAllowed: boolean;
  productionAnalyticsAllowed: boolean;
  pimShadowAllowed: boolean;
  databaseBindingMatches: boolean;
  databaseProjectRef: string | null;
}

export function getRuntimeSafetyStatus(environment: NodeJS.ProcessEnv = process.env): RuntimeSafetyStatus {
  const policy = getRuntimeSafetyPolicy(environment);
  const binding = checkDatabaseBinding(environment.DATABASE_URL);
  return {
    runtimeEnvironment: policy.runtimeEnvironment,
    externalWritesAllowed: policy.allowExternalWrites,
    paymentsAllowed: policy.allowPayments,
    wooMutationsAllowed: policy.allowWooMutations,
    checkoutSubmissionAllowed: policy.allowCheckoutSubmission,
    transactionalMessagingAllowed: policy.allowTransactionalMessaging,
    erpWritesAllowed: policy.allowErpWrites,
    shippingWritesAllowed: policy.allowShippingWrites,
    publicIndexingAllowed: policy.allowPublicIndexing,
    productionAnalyticsAllowed: policy.allowProductionAnalytics,
    pimShadowAllowed: policy.allowPimShadow,
    databaseBindingMatches: binding.matchesExpectedStaging,
    databaseProjectRef: binding.projectRef,
  };
}
