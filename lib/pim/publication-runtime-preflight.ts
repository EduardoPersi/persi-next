import "server-only";

// A3.6-D1 Section 11: a future controlled activation needs a way to prove,
// server-side and without ever printing DATABASE_URL, that the process the
// shadow runtime is actually running in is bound to persi-staging and not
// production. This is deploy-time/startup diagnostic, never a public
// endpoint -- do not wire this into any app/api route.
//
// A3.6-D1.8-R3 narrow exception: no live channel existed to prove this for
// the real deployed staging process (no debug endpoint, no working
// Hostinger log/env access). A single, tightly-scoped, temporary route
// (app/api/internal/staging/database-binding/route.ts) consumes
// classifyDatabaseBinding() below -- staging-only (404 elsewhere), behind
// the existing site-wide Basic Auth gate, GET-only, returning nothing but
// the 3-value classification. Removed again once the live proof is
// captured (see docs/pim/18, Section "Plano de prova ao vivo").

export const EXPECTED_STAGING_PROJECT_REF = "vtrujmhhkmvjzfklzxip";

export interface DatabaseBindingCheck {
  present: boolean;
  /** The Supabase project ref extracted from the connection string's
   * "postgres.<ref>" user segment -- a public, non-secret identifier
   * (it's the same ref used throughout this project's own documentation
   * and staging URLs). Never the password, never the full string. */
  projectRef: string | null;
  matchesExpectedStaging: boolean;
}

/**
 * Safe to log/print the RESULT of this function -- it never carries the
 * password or the full connection string, only the project ref, which is
 * already public information (it appears in the Supabase dashboard URL).
 */
export function checkDatabaseBinding(databaseUrl: string | undefined = process.env.DATABASE_URL, expectedProjectRef: string = EXPECTED_STAGING_PROJECT_REF): DatabaseBindingCheck {
  const raw = databaseUrl ?? "";
  const present = raw.length > 0;
  const match = /postgres\.([a-z0-9]+):/.exec(raw);
  const projectRef = match ? match[1] : null;
  return { present, projectRef, matchesExpectedStaging: projectRef === expectedProjectRef };
}

/**
 * A3.6-D1.5 Section 18/20: chosen safety mode is DISABLE_PIM_SHADOW, not
 * FAIL_STARTUP. Crashing the entire staging Next.js process (catalog, PDP,
 * everything) because the PIM-specific binding is wrong would take down a
 * working site over a narrower problem -- inconsistent with this whole
 * project's established pattern of narrow, local fail-closed behavior
 * (e.g. isPublicationExposable, publishBatch's per-member ownership guard)
 * rather than a single global fail-stop. When the binding does not match
 * the expected staging project ref, the effective mode is forced to "off"
 * regardless of what PIM_PUBLICATION_MODE is configured to -- the same
 * safe state already proven (A3.6-B/C) to mean zero PIM database access.
 */
export function isPimShadowSafeToRun(databaseUrl: string | undefined = process.env.DATABASE_URL, expectedProjectRef: string = EXPECTED_STAGING_PROJECT_REF): boolean {
  return checkDatabaseBinding(databaseUrl, expectedProjectRef).matchesExpectedStaging;
}

export type DatabaseBindingClassification = "MATCH" | "WRONG" | "UNKNOWN";

/**
 * A3.6-D1.8-R3: collapses DatabaseBindingCheck into the 3-state public
 * contract for the temporary diagnostic route. Never exposes `projectRef`,
 * `present`, or anything else -- callers must discard everything but this
 * string. Any inability to determine the binding (missing DATABASE_URL, or
 * present but unparseable) is UNKNOWN, never a default MATCH.
 */
export function classifyDatabaseBinding(check: DatabaseBindingCheck): DatabaseBindingClassification {
  if (!check.present || check.projectRef === null) return "UNKNOWN";
  return check.matchesExpectedStaging ? "MATCH" : "WRONG";
}
