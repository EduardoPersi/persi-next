import "server-only";

// A3.7-A-R17-R2A: PURELY DIAGNOSTIC support for
// services/catalog/productFichaTecnica.ts. Nothing in this file may ever
// influence what resolveFichaTecnicaSpecifications() decides or returns --
// it only describes, after the fact, what already happened. In particular,
// classifyRawPimModeForDiagnostics() below is a SEPARATE, independent
// classifier from lib/pim/publication-flags.ts's own getPimPublicationFlags()
// parser: it never trims, lowercases, or unquotes the real value used for
// the actual mode decision, and its output is never fed back into that
// decision. The two must stay decoupled -- hardening the real parser
// (should a future round decide to) is a SEPARATE change from this
// diagnostic classifier, per A3.7-A-R17-R2A Section 3/12's explicit
// instruction not to conflate root-cause fixing with observability.

/** Safe to log: never the raw string itself, only which BUCKET it falls
 * into. A human reading logs can tell "this looks like it had a stray
 * character" without this repo ever having printed what that character
 * was, which could -- in principle, for a general-purpose env var reader --
 * be operator-authored free text. */
export type PimModeRawClass =
  | "MISSING"
  | "EXACT_OFF"
  | "EXACT_SHADOW"
  | "EXACT_CANARY"
  | "TRIMMED_OFF"
  | "TRIMMED_SHADOW"
  | "TRIMMED_CANARY"
  | "CASE_VARIANT"
  | "QUOTED_VALUE"
  | "OTHER";

const KNOWN_VALUES = ["off", "shadow", "canary"] as const;

/** Pure, deterministic, side-effect-free. Given the exact raw string
 * process.env.PIM_PUBLICATION_MODE holds (or undefined), buckets it into a
 * safe diagnostic class. Never mutates, never normalizes for use elsewhere. */
export function classifyRawPimModeForDiagnostics(raw: string | undefined): PimModeRawClass {
  if (raw === undefined) return "MISSING";
  if (raw === "off") return "EXACT_OFF";
  if (raw === "shadow") return "EXACT_SHADOW";
  if (raw === "canary") return "EXACT_CANARY";

  const trimmed = raw.trim();
  if (trimmed !== raw) {
    if (trimmed === "off") return "TRIMMED_OFF";
    if (trimmed === "shadow") return "TRIMMED_SHADOW";
    if (trimmed === "canary") return "TRIMMED_CANARY";
  }

  const isQuoted = (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) || (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2);
  if (isQuoted) return "QUOTED_VALUE";

  const lowered = trimmed.toLowerCase();
  if ((KNOWN_VALUES as readonly string[]).includes(lowered)) return "CASE_VARIANT";

  return "OTHER";
}

/** The ONLY place this repo reads the raw env string for diagnostic
 * purposes -- returns it to the caller for classification, never for
 * logging verbatim. Kept as its own function (rather than inlining
 * process.env access in the orchestrator) purely so tests can inject a
 * value without setting real process.env. */
export function getRawPimPublicationModeForDiagnostics(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  return environment.PIM_PUBLICATION_MODE;
}

/** Closed set of every real early-return / outcome branch in
 * resolveFichaTecnicaSpecifications(), in the order they can fire. Mirrors
 * the ACTUAL code paths -- nothing here describes a state the function
 * cannot reach. */
export type FichaTecnicaDiagnosticReason =
  | "MODE_NOT_CANARY"
  | "UNSAFE_DB_BINDING"
  | "PRODUCT_NOT_RESOLVED"
  | "NO_ACTIVE_CANARY_MEMBERSHIP"
  | "NO_PUBLISHED_ATTRIBUTES"
  | "NO_INTERSECTION"
  | "NO_CURRENTLY_ELIGIBLE_ATTRIBUTES"
  | "NO_SAFE_MERGE_ADDITIONS"
  | "TIMEOUT"
  | "ERROR"
  | "SUCCESS";

/** Coarse status. SKIPPED covers every deliberate fail-closed branch
 * (identical to today's Woo-only rendering, by design); SUCCESS is the
 * only branch where a PIM value actually reaches the response; ERROR is
 * reserved for the timeout/exception catch-all, which is fail-closed in
 * effect but worth distinguishing from a deliberate gate for diagnosis. */
export type FichaTecnicaDiagnosticResult = "SKIPPED" | "SUCCESS" | "ERROR";

/** A3.7-A-R17-R2A-D6: per-stage timing, added to localize where the
 * DEFAULT_TIMEOUT_MS budget is actually being spent (cold-connection setup
 * vs. query execution vs. later stages) without ever needing to log a
 * slug/productId/value. Each field is populated ONLY once that stage
 * actually completes -- on a TIMEOUT, the stage that was in flight when the
 * clock ran out is identifiable by being the first `null` after the last
 * non-null field, with no additional data needed to see that. Purely
 * additive: none of these numbers can change what resolveFichaTecnicaSpecifications
 * returns. */
export interface FichaTecnicaStageTimings {
  productResolutionMs: number | null;
  membershipMs: number | null;
  publicationReadMs: number | null;
  eligibilityMs: number | null;
  mergeMs: number | null;
}

/** Everything this feature is allowed to log. No product slug, no
 * productId, no SKU, no attribute values, no env value, no connection
 * string, no session/user identity -- only counts, enums, and timing. */
export interface FichaTecnicaDiagnosticEvent extends FichaTecnicaStageTimings {
  resolvedMode: "off" | "shadow" | "canary";
  modeRawClass: PimModeRawClass;
  productResolved: boolean;
  membershipCount: number | null;
  publishedCount: number | null;
  intersectionCount: number | null;
  eligibleCount: number | null;
  mergeAdditionCount: number | null;
  result: FichaTecnicaDiagnosticResult;
  reason: FichaTecnicaDiagnosticReason;
  durationMs: number;
}
