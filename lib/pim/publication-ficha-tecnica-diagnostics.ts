import "server-only";
import { createHash } from "node:crypto";

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

// A3.7-A-R17-R2A-D8: found live in staging (D7-R1) that a single manual PDP
// refresh can produce SEVERAL [pim-ficha-tecnica-canary] events in the same
// short window -- proven (see the D8 artifact) to be Next.js's own <Link
// prefetch={true}> behavior on the related-products/recently-viewed/adjacent-
// navigation cards rendered on that SAME page, each independently
// server-rendering ITS OWN linked product's page (and therefore independently
// invoking this orchestrator for THAT product) when not yet cached. Without
// any way to tell which event belongs to which product, a real cold/warm or
// success/failure timing observation could not be attributed to the specific
// product being tested.
//
// A per-product correlation tag closes that gap WITHOUT logging anything
// identifying: it is a short, truncated SHA-256 digest of the resolved PIM
// product UUID. This is deliberately a PLAIN hash, not an HMAC with a secret
// salt -- product UUIDs are already unguessable, high-entropy random values
// (not enumerable public strings the way a slug is), so a bare hash already
// resists reversal by anyone WITHOUT independent database access; anyone
// WHO already has database access gains nothing from a rainbow table they
// could otherwise get by simply querying the database directly, so a salted
// HMAC would add a secret-management burden (a new env var / server-only
// value to protect, explicitly discouraged this round when avoidable)
// without closing a real, distinct threat this diagnostic feature needs to
// defend against. Truncated to 12 hex characters (48 bits) -- more than
// enough to distinguish concurrent products in a single log window, while
// visibly signaling "this is a correlation tag, not a security boundary".
export function computeProductCorrelationTag(pimProductId: string): string {
  return createHash("sha256").update(pimProductId).digest("hex").slice(0, 12);
}

/** Everything this feature is allowed to log. No product slug, no raw
 * productId, no SKU, no attribute values, no env value, no connection
 * string, no session/user identity -- only counts, enums, timing, and an
 * opaque per-product correlation tag (see computeProductCorrelationTag). */
export interface FichaTecnicaDiagnosticEvent extends FichaTecnicaStageTimings {
  resolvedMode: "off" | "shadow" | "canary";
  modeRawClass: PimModeRawClass;
  /** null until the product is actually resolved (mirrors productResolved
   * being false) -- once populated, the SAME product always produces the
   * SAME tag, letting multiple events in one log window be grouped by
   * product without ever revealing which product that is. */
  productCorrelationTag: string | null;
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
