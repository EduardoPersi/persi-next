import "server-only";
import type { CatalogTerm } from "@/lib/catalog/domain";
import type { PublishedAttributeRecord } from "@/lib/pim/publication-read-model";

// A3.6-A: "candidate != official" (Section 9). PimCatalogCandidate is a
// pure, read-only projection of what a product's attributes WOULD look
// like if the publication layer were treated as a source -- it is never
// merged into, and never mutates, any official product object. It contains
// ONLY attributes that passed isPublicationExposable() (see
// lib/pim/publication-exposability.ts): no draft PAV, no eligible-but-
// unpublished PAV, no needs_review, no open-conflict, no rolled_back, no
// unpublished row ever reaches this type, because
// getPublishedAttributesForProduct(s) already filtered them out upstream.
export interface PimCatalogCandidate {
  readonly productId: string;
  readonly source: "pim-candidate";
  /** Reuses the storefront's own CatalogTerm shape (code/name/value) so a
   * candidate can be diffed against CatalogProduct.attributes without a
   * translation layer. One CatalogTerm per published attribute value --
   * an attribute with multiple published values produces multiple
   * CatalogTerm entries sharing the same `code`, mirroring how the
   * official side already represents multi-value attributes. */
  readonly attributes: readonly CatalogTerm[];
}

/**
 * Pure transformation: PublishedAttributeRecord[] -> PimCatalogCandidate.
 * No I/O, no mutation of the input array, no mutation of anything the
 * caller passes elsewhere. Compound technical values (e.g. `25mm x 1/2"`)
 * are carried through verbatim as ONE CatalogTerm.value -- this function
 * never splits, re-infers, or normalizes a canonical PIM value; that
 * decision was already made (and frozen) by the PIM extraction/enrichment
 * pipeline that produced attribute_values.display_value.
 */
export function buildPimCatalogCandidate(productId: string, publishedAttributes: readonly PublishedAttributeRecord[]): PimCatalogCandidate {
  const attributes: CatalogTerm[] = publishedAttributes.map((record) => ({
    code: record.attributeSlug,
    name: record.attributeName,
    value: record.canonicalValue,
  }));

  return { productId, source: "pim-candidate", attributes };
}
