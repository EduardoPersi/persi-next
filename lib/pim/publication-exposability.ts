import "server-only";

// A3.6-A: the SINGLE authoritative predicate for "is this publication row
// exposable". Every consumer (read model, candidate builder, future
// storefront wiring) must go through this function instead of re-checking
// `state === 'published'` inline -- that pattern is exactly what Section 8
// of A3.6-A forbids, and what let a bare `state='published'` filter in the
// A3.5 read model silently trust an orphaned/rolled-back batch. A row is
// exposable only when EVERY structural condition holds simultaneously;
// missing information is treated as NOT exposable (fail-closed), never as
// "assume fine".
export type PublicationRowState = "published" | "unpublished";
export type PublicationBatchState = "active" | "rolled_back";

export interface ExposabilityInput {
  /** state on pim_attribute_publications itself */
  publicationState: PublicationRowState | null | undefined;
  /** status of the batch that owns this publication row (null = batch row missing/orphaned) */
  batchStatus: PublicationBatchState | null | undefined;
  /** attribute_value_id currently associated to this identity in product_attribute_values, or null if that source association no longer exists */
  sourcePavAttributeValueId: string | null | undefined;
  /** the attribute_value_id the publication row claims to publish */
  attributeValueId: string;
  attributeExists: boolean;
  attributeValueExists: boolean;
}

export type ExposabilityBlockReason =
  | "NOT_PUBLISHED"
  | "BATCH_NOT_ACTIVE"
  | "MISSING_SOURCE_ASSOCIATION"
  | "IDENTITY_MISMATCH"
  | "MISSING_ATTRIBUTE"
  | "MISSING_ATTRIBUTE_VALUE";

export interface ExposabilityResult {
  exposable: boolean;
  blockReasons: ExposabilityBlockReason[];
}

export function isPublicationExposable(input: ExposabilityInput): ExposabilityResult {
  const blockReasons: ExposabilityBlockReason[] = [];

  if (input.publicationState !== "published") blockReasons.push("NOT_PUBLISHED");
  // A batch row that cannot be found (null) is treated exactly like
  // rolled_back: absence of proof of an active batch is never proof of
  // exposability.
  if (input.batchStatus !== "active") blockReasons.push("BATCH_NOT_ACTIVE");

  if (input.sourcePavAttributeValueId === null || input.sourcePavAttributeValueId === undefined) {
    blockReasons.push("MISSING_SOURCE_ASSOCIATION");
  } else if (input.sourcePavAttributeValueId !== input.attributeValueId) {
    blockReasons.push("IDENTITY_MISMATCH");
  }

  if (!input.attributeExists) blockReasons.push("MISSING_ATTRIBUTE");
  if (!input.attributeValueExists) blockReasons.push("MISSING_ATTRIBUTE_VALUE");

  return { exposable: blockReasons.length === 0, blockReasons };
}
