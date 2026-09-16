import "server-only";
import { getPersiRuntimeEnvironment } from "@/lib/runtime/runtime-environment";
import { isPimShadowSafeToRun } from "@/lib/pim/publication-runtime-preflight";

// A3.6-D1.6 Section 9: the single deterministic policy every domain-specific
// guard (payment, Woo mutation, checkout, messaging, ERP, shipping) consults.
// Production keeps its EXACT current behavior (everything allowed except
// what other, pre-existing mechanisms already gate -- this policy adds no
// new restriction to production). Staging is fail-closed by default across
// every external-effect capability; only PIM shadow can be allowed, and
// only if the A3.6 gates (mode/sample) AND the database-binding guard both
// agree.
export interface RuntimeSafetyPolicy {
  runtimeEnvironment: ReturnType<typeof getPersiRuntimeEnvironment>;
  allowExternalWrites: boolean;
  allowWooMutations: boolean;
  allowPayments: boolean;
  allowTransactionalMessaging: boolean;
  allowErpWrites: boolean;
  allowCheckoutSubmission: boolean;
  allowShippingWrites: boolean;
  allowPublicIndexing: boolean;
  allowProductionAnalytics: boolean;
  /** Whether PIM shadow observation is allowed to even be attempted. This
   * does NOT replace PIM_PUBLICATION_MODE/PIM_SHADOW_SAMPLE_RATE (A3.6-B/C)
   * -- it is an ADDITIONAL, coarser gate: false here means shadow must not
   * run regardless of those flags (e.g. staging with a mismatched DB
   * binding). True here still requires the A3.6 flags themselves to allow it. */
  allowPimShadow: boolean;
}

export function getRuntimeSafetyPolicy(environment: NodeJS.ProcessEnv = process.env): RuntimeSafetyPolicy {
  const runtimeEnvironment = getPersiRuntimeEnvironment(environment);

  if (runtimeEnvironment === "staging") {
    return {
      runtimeEnvironment,
      allowExternalWrites: false,
      allowWooMutations: false,
      allowPayments: false,
      allowTransactionalMessaging: false,
      allowErpWrites: false,
      allowCheckoutSubmission: false,
      allowShippingWrites: false,
      allowPublicIndexing: false,
      allowProductionAnalytics: false,
      allowPimShadow: isPimShadowSafeToRun(environment.DATABASE_URL),
    };
  }

  // production, development, and test all currently share today's real,
  // unrestricted behavior -- this policy introduces no new restriction for
  // any of them. Non-production, non-staging environments (dev/test) are
  // out of this round's scope (Section 2: "somente se realmente necessários").
  return {
    runtimeEnvironment,
    allowExternalWrites: true,
    allowWooMutations: true,
    allowPayments: true,
    allowTransactionalMessaging: true,
    allowErpWrites: true,
    allowCheckoutSubmission: true,
    allowShippingWrites: true,
    allowPublicIndexing: true,
    allowProductionAnalytics: true,
    allowPimShadow: true,
  };
}
