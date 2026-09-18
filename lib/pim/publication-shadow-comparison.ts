import type { CatalogProduct, CatalogTerm } from "@/lib/catalog/domain";
import type { PimCatalogCandidate } from "@/lib/pim/publication-candidate";
import { isKnownNeedsReview } from "@/lib/pim/publication-needs-review-registry";
import { SUPPORTED_ATTRIBUTE_CODES, type SupportedAttributeCode } from "@/lib/pim/publication-eligibility";

// A3.6-A Section 11: a SEPARATE, per-attribute-granular comparator from
// lib/catalog/comparison.ts's compareCatalogProducts(), which is the
// existing WHOLE-CATALOG (price/title/images/attributes-as-one-bucket)
// Woo-vs-Postgres comparator wired into lib/catalog/shadowCore.ts. That
// comparator answers "did the whole product diverge"; this one answers
// "for each PIM-published attribute specifically, how does it relate to
// what the official catalog already shows, and is that divergence
// meaningful or just presentational". The two are deliberately not merged,
// for the same reason lib/pim/publication-flags.ts keeps PimPublicationMode
// separate from CatalogDataSource: they answer different questions at
// different granularities and mixing them would make either one harder to
// reason about alone.
//
// Purely deterministic. No AI, no heuristic scoring, no network I/O.

export type AttributeDifferenceClassification =
  | "MATCH"
  | "PIM_ONLY"
  | "OFFICIAL_ONLY"
  | "VALUE_DIFFERENCE"
  | "MULTI_VALUE_DIFFERENCE"
  | "ORDER_ONLY_DIFFERENCE"
  | "UNRESOLVABLE"
  | "BLOCKED";

export interface AttributeDifference {
  code: string;
  classification: AttributeDifferenceClassification;
  officialValues: string[];
  candidateValues: string[];
  /** Present only for BLOCKED: why the candidate side was blocked from comparison. */
  blockedReason?: string;
}

export interface CatalogShadowComparison {
  productId: string;
  official: { sku: string; attributeCount: number };
  candidate: { attributeCount: number };
  differences: AttributeDifference[];
  /**
   * Deterministic, documented rule ONLY: true iff every attribute code the
   * candidate actually publishes classifies as MATCH against official (and
   * none of them are BLOCKED or UNRESOLVABLE). Codes the candidate does not
   * publish at all (OFFICIAL_ONLY) do not count against this -- an
   * attribute PIM hasn't touched yet is not a "failure", it is simply not
   * yet part of what this candidate could canary. This is NOT a score and
   * MUST NOT be interpreted as "safe to auto-publish" -- it only means the
   * comparison layer found no reason, today, to block a FUTURE human
   * decision to canary this product's already-published attributes.
   */
  safeForFutureCanary: boolean;
}

const normalize = (value: string): string => value.normalize("NFKC").replace(/\s+/g, " ").trim();

// A3.7-A-R7 found that the official (Woo) side's CatalogTerm.code
// (services/catalog/woocommerce.ts: `attribute.taxonomy ?? attribute.name`)
// and the PIM candidate side's code (always the bare
// public.attributes.code -- lib/pim/publication-candidate.ts) are two
// DIFFERENT vocabularies for the same four concepts: a real WooCommerce
// GLOBAL attribute's taxonomy always carries the platform's own "pa_"
// prefix (confirmed against this project's own ingestion code,
// services/woocommerce/search.ts: `attribute.slug || "pa_" + slugify(...)`),
// while the PIM side's code is plain ("material", "conexao", "comprimento",
// "volume"). Nothing before A3.7-A-R8 reconciled them, so MATCH/
// VALUE_DIFFERENCE for these four attributes was structurally unreachable
// even where the official and PIM values genuinely agreed.
//
// This is an explicit, closed allowlist -- NEVER a generic "pa_" stripper.
// Its codomain is intentionally restricted to exactly
// SUPPORTED_ATTRIBUTE_CODES: the only codes a PIM candidate can ever carry,
// because publishBatch() re-checks evaluatePublicationEligibility() (which
// rejects anything else as ATTRIBUTE_NOT_SUPPORTED) before a
// pim_attribute_publications row can ever be written. An official code with
// no entry here is returned unchanged -- it stays OFFICIAL_ONLY (or simply
// unmatched), never silently equated to a PIM code. A Woo LOCAL/custom
// attribute (taxonomy === null, code falls back to attribute.name, e.g.
// "Material do produto") is never in this allowlist by construction and is
// therefore never auto-matched -- fail-closed, per A3.7-A-R8 Section 3.
// Exact-string lookup only: no case-folding, no accent/hyphen/underscore
// normalization, no fuzzy matching -- WooCommerce's own taxonomy slugs are
// already lowercase-with-underscores by platform convention, and guessing
// at variants would risk equating attributes that only look alike.
const OFFICIAL_TO_PIM_ATTRIBUTE_CODE: Readonly<Record<string, SupportedAttributeCode>> = {
  pa_material: "material",
  pa_conexao: "conexao",
  pa_comprimento: "comprimento",
  pa_volume: "volume",
};

// Self-verifying guard, cheap enough to run unconditionally at module load
// (mirrors this project's own convention of asserting an invariant instead
// of merely documenting it -- e.g. the DO blocks in
// supabase/migrations/20260917120000_admin_membership_server_read_policy.sql):
// every value this allowlist can ever produce must be one of the four codes
// SUPPORTED_ATTRIBUTE_CODES actually recognizes. If a future edit adds an
// entry mapping to anything else, this fails loudly at import time instead
// of silently producing a code the rest of the publication layer would
// reject as ATTRIBUTE_NOT_SUPPORTED.
for (const target of Object.values(OFFICIAL_TO_PIM_ATTRIBUTE_CODE)) {
  if (!SUPPORTED_ATTRIBUTE_CODES.includes(target)) {
    throw new Error(`OFFICIAL_TO_PIM_ATTRIBUTE_CODE maps to an unsupported PIM attribute code: ${target}`);
  }
}

/** Pure, explicit, fail-closed: canonicalizes a known official attribute
 * code into the PIM vocabulary so the comparator can recognize it is the
 * SAME semantic attribute. Never infers, never transforms unknown codes,
 * never touches values. Codes outside the allowlist pass through unchanged. */
export function canonicalizeOfficialAttributeCode(rawCode: string): string {
  return OFFICIAL_TO_PIM_ATTRIBUTE_CODE[rawCode] ?? rawCode;
}

function groupByCode(terms: readonly CatalogTerm[], canonicalize?: (code: string) => string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const term of terms) {
    const code = canonicalize ? canonicalize(term.code) : term.code;
    const list = map.get(code) ?? [];
    list.push(term.value);
    map.set(code, list);
  }
  return map;
}

function classifyValues(officialValues: string[], candidateValues: string[]): AttributeDifferenceClassification {
  if (officialValues.some((v) => v == null) || candidateValues.some((v) => v == null)) return "UNRESOLVABLE";

  const officialNormalized = officialValues.map(normalize);
  const candidateNormalized = candidateValues.map(normalize);

  const officialSorted = [...officialNormalized].sort();
  const candidateSorted = [...candidateNormalized].sort();
  const sameSet = officialSorted.length === candidateSorted.length && officialSorted.every((v, i) => v === candidateSorted[i]);

  if (!sameSet) {
    return officialNormalized.length > 1 || candidateNormalized.length > 1 ? "MULTI_VALUE_DIFFERENCE" : "VALUE_DIFFERENCE";
  }

  const sameOrder = officialNormalized.length === candidateNormalized.length && officialNormalized.every((v, i) => v === candidateNormalized[i]);
  return sameOrder ? "MATCH" : "ORDER_ONLY_DIFFERENCE";
}

/**
 * Compares an official (Woo-sourced) product with its PIM candidate view.
 * Pure function: does not mutate `official` or `candidate`, performs no
 * I/O. `official` must be the already-resolved CatalogProduct (its `sku`
 * field is used, synchronously, to consult the static NEEDS_REVIEW
 * registry -- see lib/pim/publication-needs-review-registry.ts -- no
 * database join happens here).
 */
export function compareOfficialWithPimCandidate(official: CatalogProduct, candidate: PimCatalogCandidate): CatalogShadowComparison {
  // Canonicalization applies ONLY to the official side's grouping key, and
  // ONLY here (A3.7-A-R8 Section 4) -- `official`/`candidate` themselves are
  // never mutated, and every `code` this function reports downstream is
  // simply whichever grouping key produced that difference, so a
  // reconciled attribute is reported under the PIM vocabulary (the same
  // code publication/eligibility already use), while an unreconciled
  // official-only code (e.g. "pa_marca") is reported exactly as WooCommerce
  // named it.
  const officialByCode = groupByCode(official.attributes, canonicalizeOfficialAttributeCode);
  const candidateByCode = groupByCode(candidate.attributes);
  const allCodes = new Set<string>([...officialByCode.keys(), ...candidateByCode.keys()]);

  const differences: AttributeDifference[] = [];
  for (const code of allCodes) {
    const officialValues = officialByCode.get(code) ?? [];
    const candidateValues = candidateByCode.get(code) ?? [];

    // Section 15: the candidate/comparison layer must never silently
    // route around a known structural NEEDS_REVIEW case just because the
    // read model already excludes truly unpublished rows -- a product+
    // attribute pair on the static registry is blocked from comparison
    // outright, even if (hypothetically, e.g. a future bug) the candidate
    // did carry a value for it.
    if (candidateByCode.has(code) && isKnownNeedsReview(official.sku, code)) {
      differences.push({ code, classification: "BLOCKED", officialValues, candidateValues, blockedReason: "KNOWN_NEEDS_REVIEW_REGISTRY" });
      continue;
    }

    if (!candidateByCode.has(code)) {
      differences.push({ code, classification: "OFFICIAL_ONLY", officialValues, candidateValues });
      continue;
    }
    if (!officialByCode.has(code)) {
      differences.push({ code, classification: "PIM_ONLY", officialValues, candidateValues });
      continue;
    }

    differences.push({ code, classification: classifyValues(officialValues, candidateValues), officialValues, candidateValues });
  }

  differences.sort((a, b) => a.code.localeCompare(b.code));

  const candidateCodes = new Set(candidateByCode.keys());
  const relevantToCanary = differences.filter((d) => candidateCodes.has(d.code));
  const safeForFutureCanary = relevantToCanary.length > 0 && relevantToCanary.every((d) => d.classification === "MATCH");

  return {
    productId: candidate.productId,
    official: { sku: official.sku, attributeCount: official.attributes.length },
    candidate: { attributeCount: candidate.attributes.length },
    differences,
    safeForFutureCanary,
  };
}
