import type { CatalogProduct, CatalogTerm } from "@/lib/catalog/domain";
import type { PimCatalogCandidate } from "@/lib/pim/publication-candidate";
import { compareOfficialWithPimCandidate, type AttributeDifference } from "@/lib/pim/publication-shadow-comparison";
import type { ProductSpecification } from "@/types/product";

// A3.7-A-R15: the PURE merge step of the Ficha Técnica canary design
// qualified in A3.7-A-R14-R5. Deliberately separate from
// services/catalog/productFichaTecnica.ts (the async, I/O-performing
// orchestrator) -- this file does no I/O, has no side effects, never
// mutates its inputs, and reimplements zero comparison logic: it calls the
// ALREADY-EXISTING compareOfficialWithPimCandidate() and only decides,
// deterministically, what that comparison's `differences` mean for the
// RENDERED specification list.
//
// Purely deterministic. No AI, no heuristic scoring, no network/DB I/O.

export interface FichaTecnicaMergeResult {
  specifications: ProductSpecification[];
  /** VALUE_DIFFERENCE / MULTI_VALUE_DIFFERENCE / UNRESOLVABLE entries only --
   * never merged into `specifications`, provided so a caller MAY optionally
   * emit an observability event (e.g. via the existing shadow telemetry
   * sink) without this pure function itself performing any side effect. */
  observableDifferences: readonly AttributeDifference[];
}

const normalizeLabelKey = (name: string): string => name.normalize("NFKC").trim().toLowerCase();

/** Reproduces, from CatalogTerm[] (code/name/value triples), exactly the
 * same grouping-by-display-name and comma-joining that
 * components/Product/ProductDetails.tsx's existing Woo-only fallback
 * already does from the raw ProductAttribute[] shape -- same output, same
 * order (first-seen order, i.e. array order, matching
 * docs/pim/11 Section 1's confirmation that Woo attribute order has no
 * explicit order field). Never touches PIM at all. */
function groupOfficialByName(terms: readonly CatalogTerm[]): { order: string[]; byName: Map<string, { label: string; values: string[] }> } {
  const byName = new Map<string, { label: string; values: string[] }>();
  const order: string[] = [];
  for (const term of terms) {
    const key = normalizeLabelKey(term.name);
    const existing = byName.get(key);
    if (existing) {
      existing.values.push(term.value);
      continue;
    }
    byName.set(key, { label: term.name, values: [term.value] });
    order.push(key);
  }
  return { order, byName };
}

/**
 * Builds the final Ficha Técnica specification list for a canary-eligible
 * product. `official` and `candidate` are never mutated (verified by test,
 * matching compareOfficialWithPimCandidate's own existing non-mutation
 * guarantee). `candidate` must already contain ONLY attributes this
 * request is authorized to expose -- this function performs no
 * eligibility/canary-membership decision itself; that happens upstream, in
 * the orchestrator, using the real publication read model.
 *
 * Merge matrix (A3.7-A-R14-R5, refined from docs/pim/10's original design
 * to be strictly fail-closed -- see that round's artifact for the full
 * reasoning):
 *   PIM_ONLY                                    -> ADD a new specification.
 *   MATCH / ORDER_ONLY_DIFFERENCE                -> keep Woo's own entry, never duplicate.
 *   OFFICIAL_ONLY                                -> keep Woo's own entry (PIM contributes nothing).
 *   VALUE_DIFFERENCE / MULTI_VALUE_DIFFERENCE /
 *   UNRESOLVABLE                                 -> NEVER overwrite Woo; returned in
 *                                                    `observableDifferences` instead, never rendered.
 *   BLOCKED                                      -> never added (defense in depth; a genuinely
 *                                                    published row should not reach this classification).
 */
export function buildFichaTecnicaSpecifications(official: CatalogProduct, candidate: PimCatalogCandidate): FichaTecnicaMergeResult {
  const comparison = compareOfficialWithPimCandidate(official, candidate);
  const { order, byName } = groupOfficialByName(official.attributes);

  const specifications: ProductSpecification[] = order.map((key) => {
    const entry = byName.get(key)!;
    return { label: entry.label, value: entry.values.join(", ") };
  });

  const observableDifferences: AttributeDifference[] = [];
  const pimOnlyAdditions: Array<{ code: string; label: string; value: string }> = [];

  for (const difference of comparison.differences) {
    if (difference.classification === "PIM_ONLY") {
      const candidateTerms = candidate.attributes.filter((term) => term.code === difference.code);
      if (candidateTerms.length === 0) continue; // defensive; cannot happen given the comparator's own contract
      pimOnlyAdditions.push({ code: difference.code, label: candidateTerms[0].name, value: candidateTerms.map((term) => term.value).join(", ") });
      continue;
    }
    if (difference.classification === "VALUE_DIFFERENCE" || difference.classification === "MULTI_VALUE_DIFFERENCE" || difference.classification === "UNRESOLVABLE") {
      observableDifferences.push(difference);
    }
    // MATCH / ORDER_ONLY_DIFFERENCE / OFFICIAL_ONLY / BLOCKED: no action.
  }

  // Deterministic, stable order for additions -- reuses the exact same
  // convention compareOfficialWithPimCandidate itself already applies to
  // `differences` (lib/pim/publication-shadow-comparison.ts's own
  // `differences.sort((a, b) => a.code.localeCompare(b.code))`), rather
  // than inventing a new ordering rule.
  pimOnlyAdditions.sort((a, b) => a.code.localeCompare(b.code));
  for (const addition of pimOnlyAdditions) {
    specifications.push({ label: addition.label, value: addition.value });
  }

  return { specifications, observableDifferences };
}
