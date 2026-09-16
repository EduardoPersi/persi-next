import "server-only";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db";
import { isPublicationExposable, type ExposabilityBlockReason } from "@/lib/pim/publication-exposability";

export type PublishedProductAttribute = { attributeCode: string; attributeName: string; value: string; publishedAt: Date; batchId: string };

// The ONLY read path this foundation exposes for "what is actually
// published for this product". Never reads attributes.status as the
// authority (that governs the whole-attribute shadow gate in
// services/catalog/postgres.ts, a separate and coarser mechanism) and never
// returns the raw contents of product_attribute_values. A row is returned
// only when THREE things are simultaneously true: (1) a 'published'
// pim_attribute_publications row exists for this exact identity: (2) the
// SAME identity still exists in product_attribute_values (source truth
// could have moved on since publication -- this defends against a stale
// publication surviving a since-changed association); (3) the referenced
// attribute_value still resolves to a real row. Any drift on (2) or (3)
// silently excludes the row rather than throwing -- callers get a smaller,
// correct answer instead of a broken product page.
export async function getPublishedProductAttributes(productId: string): Promise<PublishedProductAttribute[]> {
  const rows = await getDatabase().execute(sql`
    select a.code as "attributeCode", a.name as "attributeName", av.display_value as value,
      pap.published_at as "publishedAt", pap.batch_id::text as "batchId"
    from public.pim_attribute_publications pap
    join public.product_attribute_values pav
      on pav.product_id = pap.product_id
      and pav.attribute_id = pap.attribute_id
      and pav.attribute_value_id = pap.attribute_value_id
    join public.attributes a on a.id = pap.attribute_id
    join public.attribute_values av on av.id = pap.attribute_value_id
    where pap.product_id = ${productId}::uuid and pap.state = 'published'
    order by a.code
  `);
  return rows as unknown as PublishedProductAttribute[];
}

export type PublicationCanaryMembership = { productId: string; attributeCode: string; batchId: string };

// Explicit membership lookup for canary routing (Section 19): "does this
// product currently have ANY active (non-rolled-back) published attribute
// from an explicit canary batch?" -- never a percentage bucket, never
// "first N", never attributes.status. A product with zero rows here must
// behave EXACTLY as it does today, unconditionally.
export async function getActiveCanaryMembership(productId: string): Promise<PublicationCanaryMembership[]> {
  const rows = await getDatabase().execute(sql`
    select pap.product_id::text as "productId", a.code as "attributeCode", pap.batch_id::text as "batchId"
    from public.pim_attribute_publications pap
    join public.pim_publication_batches b on b.id = pap.batch_id and b.kind = 'canary' and b.status = 'active'
    join public.attributes a on a.id = pap.attribute_id
    where pap.product_id = ${productId}::uuid and pap.state = 'published'
    order by a.code
  `);
  return rows as unknown as PublicationCanaryMembership[];
}

// ---------------------------------------------------------------------------
// A3.6-A: native, batch-oriented read model. Distinct from
// getPublishedProductAttributes above (kept as-is for A3.5 compatibility):
// this API (1) resolves full identity (productId/attributeId/attributeValueId
// -- required by the candidate/comparison layer, not just a display string),
// (2) fetches N products in ONE query instead of one query per product
// (category/listing/search need this), and (3) routes every row through the
// single isPublicationExposable() predicate instead of re-encoding
// "state='published'" as a query filter -- so the exposability rule lives in
// exactly one place even when the raw candidate rows come with extra
// (non-exposable) context attached, which SQL alone cannot express as
// cleanly once batch status and orphaned-batch defense are both required.
export interface PublishedAttributeRecord {
  productId: string;
  attributeId: string;
  attributeSlug: string;
  attributeName: string;
  attributeValueId: string;
  canonicalValue: string;
  publicationState: "published" | "unpublished";
  batchId: string;
  publishedAt: Date | null;
}

type RawPublicationCandidateRow = {
  productId: string;
  attributeId: string;
  attributeSlug: string | null;
  attributeName: string | null;
  attributeValueId: string;
  canonicalValue: string | null;
  publicationState: "published" | "unpublished";
  batchId: string;
  batchStatus: "active" | "rolled_back" | null;
  publishedAt: Date | null;
  sourcePavAttributeValueId: string | null;
};

/**
 * Batch-fetches publication candidate rows for N products in a single
 * round trip and returns only the ones that pass isPublicationExposable(),
 * grouped by productId. Products with no exposable rows are present in the
 * map with an empty array (never absent), so callers can always safely
 * index by productId without an existence check.
 */
export async function getPublishedAttributesForProducts(productIds: string[]): Promise<Map<string, PublishedAttributeRecord[]>> {
  const result = new Map<string, PublishedAttributeRecord[]>(productIds.map((id) => [id, []]));
  if (productIds.length === 0) return result;

  const rows = (await getDatabase().execute(sql`
    select
      pap.product_id::text as "productId",
      pap.attribute_id::text as "attributeId",
      a.code as "attributeSlug",
      a.name as "attributeName",
      pap.attribute_value_id::text as "attributeValueId",
      av.display_value as "canonicalValue",
      pap.state::text as "publicationState",
      pap.batch_id::text as "batchId",
      b.status::text as "batchStatus",
      pap.published_at as "publishedAt",
      pav.attribute_value_id::text as "sourcePavAttributeValueId"
    from public.pim_attribute_publications pap
    left join public.pim_publication_batches b on b.id = pap.batch_id
    left join public.attributes a on a.id = pap.attribute_id
    left join public.attribute_values av on av.id = pap.attribute_value_id
    left join public.product_attribute_values pav
      on pav.product_id = pap.product_id
      and pav.attribute_id = pap.attribute_id
    where pap.product_id in (${sql.join(productIds.map((id) => sql`${id}::uuid`), sql`, `)})
    order by pap.product_id, a.code
  `)) as unknown as RawPublicationCandidateRow[];

  for (const row of rows) {
    const { exposable } = isPublicationExposable({
      publicationState: row.publicationState,
      batchStatus: row.batchStatus,
      sourcePavAttributeValueId: row.sourcePavAttributeValueId,
      attributeValueId: row.attributeValueId,
      attributeExists: row.attributeSlug !== null,
      attributeValueExists: row.canonicalValue !== null,
    });
    if (!exposable) continue;

    const record: PublishedAttributeRecord = {
      productId: row.productId,
      attributeId: row.attributeId,
      attributeSlug: row.attributeSlug as string,
      attributeName: row.attributeName as string,
      attributeValueId: row.attributeValueId,
      canonicalValue: row.canonicalValue as string,
      publicationState: row.publicationState,
      batchId: row.batchId,
      publishedAt: row.publishedAt,
    };
    result.get(row.productId)?.push(record);
  }

  return result;
}

/** Single-product convenience wrapper over the batch API. Prefer the batch
 * form (getPublishedAttributesForProducts) for any listing/search path --
 * this exists for PDP-style single-product call sites only. */
export async function getPublishedAttributesForProduct(productId: string): Promise<PublishedAttributeRecord[]> {
  const map = await getPublishedAttributesForProducts([productId]);
  return map.get(productId) ?? [];
}

/** Exposed for tests/diagnostics that need to see WHY a row was excluded,
 * without duplicating the exposability predicate wiring. Not for
 * storefront use -- block reasons are an internal/PIM-admin concept. */
export async function explainNonExposableAttributesForProduct(productId: string): Promise<Array<{ attributeSlug: string | null; attributeValueId: string; blockReasons: ExposabilityBlockReason[] }>> {
  const rows = (await getDatabase().execute(sql`
    select
      pap.attribute_value_id::text as "attributeValueId",
      a.code as "attributeSlug",
      a.name as "attributeName",
      av.display_value as "canonicalValue",
      pap.state::text as "publicationState",
      b.status::text as "batchStatus",
      pav.attribute_value_id::text as "sourcePavAttributeValueId"
    from public.pim_attribute_publications pap
    left join public.pim_publication_batches b on b.id = pap.batch_id
    left join public.attributes a on a.id = pap.attribute_id
    left join public.attribute_values av on av.id = pap.attribute_value_id
    left join public.product_attribute_values pav
      on pav.product_id = pap.product_id
      and pav.attribute_id = pap.attribute_id
    where pap.product_id = ${productId}::uuid
    order by a.code
  `)) as unknown as Array<{ attributeValueId: string; attributeSlug: string | null; attributeName: string | null; canonicalValue: string | null; publicationState: "published" | "unpublished"; batchStatus: "active" | "rolled_back" | null; sourcePavAttributeValueId: string | null }>;

  return rows.map((row) => ({
    attributeSlug: row.attributeSlug,
    attributeValueId: row.attributeValueId,
    blockReasons: isPublicationExposable({
      publicationState: row.publicationState,
      batchStatus: row.batchStatus,
      sourcePavAttributeValueId: row.sourcePavAttributeValueId,
      attributeValueId: row.attributeValueId,
      attributeExists: row.attributeSlug !== null,
      attributeValueExists: row.canonicalValue !== null,
    }).blockReasons,
  }));
}
