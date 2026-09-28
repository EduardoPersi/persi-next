// A3.7-FINAL-B-R1: READ-ONLY staging qualification, executed locally via the
// project's own DATABASE_URL (Hostinger MCP tools are disconnected this
// session -- this is the "meios READ-ONLY disponiveis" fallback the round
// explicitly authorizes). Zero writes. Only SELECTs, and only the REAL,
// unmodified pipeline functions (never a reimplementation) -- same
// discipline as scripts/database/r17r1b-readonly-reconcile.mjs from an
// earlier round of this same engagement. Disposable: not part of the PIM
// v1 checkpoint, not committed.
import { createHash } from "node:crypto";
import { getDatabase } from "../../lib/db/connection.ts";

const { getActiveCanaryMembership, getPublishedAttributesForProduct } = await import("../../lib/pim/publication-read-model.ts");
const { evaluatePublicationEligibilityBatch } = await import("../../lib/pim/publication-eligibility.ts");
const { computeProductCorrelationTag } = await import("../../lib/pim/publication-ficha-tecnica-diagnostics.ts");
const { sql } = await import("drizzle-orm");

const db = getDatabase();
const out = {};

// ---- Section 3: runtime/source confirmation (schema-shape proof, not a network call) ----
const hasNotReviewedCapableColumn = await db.execute(sql`select column_name from information_schema.columns where table_name='pim_attribute_reviews' and column_name='status'`);
out.reviewStatusColumnExists = hasNotReviewedCapableColumn.length > 0;

// ---- Section 4: baseline counts ----
const counts = await db.execute(sql`
  select
    (select count(*)::int from public.pim_attribute_reviews) as "reviewsTotal",
    (select count(*)::int from public.pim_attribute_decisions) as "decisionsTotal",
    (select count(*)::int from public.pim_audit_log) as "auditTotal",
    (select count(*)::int from public.pim_publication_batches) as "batchesTotal",
    (select count(*)::int from public.pim_attribute_publications) as "publicationsTotal",
    (select count(*)::int from public.pim_attribute_publications where state='published') as "publishedRowsTotal"
`);
out.baselineCounts = counts[0];

// ---- 0117 and PVCB5M state ----
async function productState(slug, sku) {
  const slugRows = await db.execute(sql`select id::text as id from public.products where slug = ${slug} limit 1`);
  const productId = slugRows[0]?.id ?? null;
  if (!productId) return { sku, slug, found: false };

  const membership = await getActiveCanaryMembership(productId);
  const published = await getPublishedAttributesForProduct(productId);
  const reviewRows = await db.execute(sql`
    select a.code as "attributeCode", r.status::text as "reviewStatus", r.reviewed_by as "reviewedBy", r.reviewed_at as "reviewedAt"
    from public.pim_attribute_reviews r
    join public.attributes a on a.id = r.attribute_id
    where r.product_id = ${productId}::uuid
    order by a.code
  `);

  let eligibility = [];
  if (published.length > 0) {
    const identities = published.map((r) => ({ productId: r.productId, attributeId: r.attributeId, attributeValueId: r.attributeValueId }));
    const eligibilityMap = await evaluatePublicationEligibilityBatch(db, identities);
    eligibility = [...eligibilityMap.entries()].map(([, result]) => ({ attributeCode: result.attributeCode, eligible: result.eligible, reasonCodes: result.reasonCodes }));
  }

  return {
    sku,
    slug,
    found: true,
    correlationTag: computeProductCorrelationTag(productId),
    membershipCount: membership.length,
    publishedCount: published.length,
    publishedAttributes: published.map((r) => r.attributeSlug),
    reviewRowCount: reviewRows.length,
    reviewRows: reviewRows.map((r) => ({ attributeCode: r.attributeCode, reviewStatus: r.reviewStatus })),
    approvedCount: reviewRows.filter((r) => r.reviewStatus === "approved").length,
    eligibleCount: eligibility.filter((e) => e.eligible).length,
    eligibility,
  };
}

out.product0117 = await productState("tubo-pvc-branco-roscavel-1-2-krona-6m", "0117");

// PVCB5M's slug was never captured verbatim in this engagement's memory --
// resolve it by SKU via product_variants instead of guessing a slug.
const pvcb5mVariant = await db.execute(sql`select p.slug as "slug" from public.product_variants v join public.products p on p.id = v.product_id where v.sku = 'PVCB5M' limit 1`);
out.product_PVCB5M = pvcb5mVariant[0]?.slug ? await productState(pvcb5mVariant[0].slug, "PVCB5M") : { sku: "PVCB5M", found: false, note: "no product_variants row with this exact sku" };

// ---- Sample candidates: real, read-only lookups for the remaining slots ----
const sample = {};

sample.volumeExample = await db.execute(sql`
  select v.sku, p.slug, av.display_value as "value"
  from public.product_attribute_values pav
  join public.attributes a on a.id = pav.attribute_id and a.code = 'volume'
  join public.attribute_values av on av.id = pav.attribute_value_id
  join public.products p on p.id = pav.product_id
  join public.product_variants v on v.product_id = p.id
  order by v.created_at
  limit 3
`);

sample.rejectedExample = await db.execute(sql`
  select v.sku, p.slug, a.code as "attributeCode", av.display_value as "value"
  from public.pim_attribute_reviews r
  join public.products p on p.id = r.product_id
  join public.product_variants v on v.product_id = p.id
  join public.attributes a on a.id = r.attribute_id
  join public.attribute_values av on av.id = r.attribute_value_id
  where r.status = 'rejected'
  order by r.reviewed_at desc nulls last
  limit 3
`);

sample.needsReviewExample = await db.execute(sql`
  select v.sku, p.slug, a.code as "attributeCode", av.display_value as "value"
  from public.pim_attribute_reviews r
  join public.products p on p.id = r.product_id
  join public.product_variants v on v.product_id = p.id
  join public.attributes a on a.id = r.attribute_id
  join public.attribute_values av on av.id = r.attribute_value_id
  where r.status = 'needs_review'
  limit 3
`);

sample.openConflictExample = await db.execute(sql`
  select v.sku, p.slug, c.attribute_key as "attributeKey"
  from public.pim_conflicts c
  join public.products p on p.id = c.product_id
  join public.product_variants v on v.product_id = p.id
  where c.status = 'open'
  order by c.created_at
  limit 3
`);

sample.zeroEligiblePimAttributeExample = await db.execute(sql`
  select v.sku, p.slug
  from public.products p
  join public.product_variants v on v.product_id = p.id
  where not exists (select 1 from public.pim_attribute_publications pap where pap.product_id = p.id)
  order by v.created_at desc
  limit 3
`);

sample.approvedExample = await db.execute(sql`
  select v.sku, p.slug, a.code as "attributeCode", av.display_value as "value"
  from public.pim_attribute_reviews r
  join public.products p on p.id = r.product_id
  join public.product_variants v on v.product_id = p.id
  join public.attributes a on a.id = r.attribute_id
  join public.attribute_values av on av.id = r.attribute_value_id
  where r.status = 'approved'
  limit 5
`);

out.sample = sample;

console.log(JSON.stringify(out, null, 2));
process.exit(0);
