import "server-only";

export type NeedsReviewRegistryEntry = { sku: string; attributeCode: string; reason: string };

// Explicit, version-controlled registry of associations documented across
// A3.5E-P2 as NEEDS_REVIEW with NO structural DB flag today (confirmed in
// A3.5E-P2-V/P2-W/P2-X: neither has a pim_conflicts row nor a
// pim_attribute_reviews row -- the block exists only as a narrative finding
// in prior audit reports). A3.5E-P3-B's own safety review rejected relying
// on "callers remember to exclude these two SKUs" as unsafe -- this module
// is the fail-closed replacement: evaluatePublicationEligibility consults
// it unconditionally, for every call, with no caller involvement.
//
// SKU here is a human-authoring convenience ONLY, never relational
// authority (A3.5E-P3-B Section 9): the eligibility gate resolves each
// row's CURRENT sku via a live join from the caller-supplied product_id
// (public.product_variants), and matches that RESOLVED value against this
// list -- the caller never supplies or overrides a SKU, and the actual
// identity driving the block is still product_id+attribute_id.
//
// This registry is a STOPGAP for the two cases that predate the structural
// mechanism this same change adds (see publication-eligibility.ts: any
// pim_attribute_reviews row with status='needs_review' now blocks too --
// every FUTURE needs-review case should be represented that way, by the
// existing admin review workflow, not by growing this list). Writing a
// real pim_attribute_reviews row for these two into persi-staging is a
// data change that requires its own explicit authorized write round
// (out of scope here, which is read-only).
export const KNOWN_NEEDS_REVIEW_REGISTRY: readonly NeedsReviewRegistryEntry[] = [
  { sku: "PA013710", attributeCode: "comprimento", reason: "Título '1,5m' vs bullet 'Comprimento do Cabo de 1 Metro' -- contradição interna não resolvida (A3.5E-P2-V)." },
  { sku: "NMEM16", attributeCode: "comprimento", reason: "Título '1,60 m' vs descrição '1,80 metros' (repetido 2x) -- contradição título/descrição não resolvida (A3.5E-P2-V)." },
];

export function isKnownNeedsReview(sku: string, attributeCode: string): boolean {
  return KNOWN_NEEDS_REVIEW_REGISTRY.some((entry) => entry.sku === sku && entry.attributeCode === attributeCode);
}
