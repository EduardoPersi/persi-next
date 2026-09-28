// A3.7-FINAL-B-R2: READ-ONLY reconciliation of REAL human review decisions
// already made by the operator in staging. Zero writes. Only SELECTs and
// the project's own unmodified read/eligibility functions.
import { getDatabase } from "../../lib/db/connection.ts";

const { getActiveCanaryMembership, getPublishedAttributesForProduct } = await import("../../lib/pim/publication-read-model.ts");
const { evaluatePublicationEligibilityBatch } = await import("../../lib/pim/publication-eligibility.ts");
const { computeProductCorrelationTag } = await import("../../lib/pim/publication-ficha-tecnica-diagnostics.ts");
const { sql } = await import("drizzle-orm");

const db = getDatabase();
const out = {};

// ---- Section 3: counts after operator actions ----
const counts = await db.execute(sql`
  select
    (select count(*)::int from public.pim_attribute_reviews) as "reviewsTotal",
    (select count(*)::int from public.pim_attribute_decisions) as "decisionsTotal",
    (select count(*)::int from public.pim_audit_log) as "auditTotal"
`);
out.countsAfter = counts[0];

// ---- audit log breakdown for review-related operations since baseline ----
const auditBreakdown = await db.execute(sql`
  select operation, count(*)::int as "count"
  from public.pim_audit_log
  where operation in ('ATTRIBUTE_DECISION_RECORDED','ATTRIBUTE_DECISION_CHANGED','CONFLICT_ATTRIBUTE_DECIDED')
  group by operation
  order by operation
`);
out.auditBreakdownReviewRelated = auditBreakdown;

const recentAudit = await db.execute(sql`
  select v.sku, al.entity_type as "entityType", al.field_name as "fieldName", al.operation, al.actor_reference as "actorReference", al.created_at as "createdAt"
  from public.pim_audit_log al
  join public.products p on p.id = al.product_id
  join public.product_variants v on v.product_id = p.id
  where al.operation in ('ATTRIBUTE_DECISION_RECORDED','ATTRIBUTE_DECISION_CHANGED','CONFLICT_ATTRIBUTE_DECIDED')
  order by al.created_at desc
  limit 20
`);
out.recentReviewAuditRows = recentAudit;

// ---- 0117 full reconciliation: all 4 attributes (comprimento/conexao/cor/material) ----
async function productReconciliation(slug, sku) {
  const slugRows = await db.execute(sql`select id::text as id from public.products where slug = ${slug} limit 1`);
  const productId = slugRows[0]?.id ?? null;
  if (!productId) return { sku, slug, found: false };

  const allReviews = await db.execute(sql`
    select a.code as "attributeCode", av.display_value as "value", r.status::text as "reviewStatus", r.reviewed_by as "reviewedBy", r.reviewed_at as "reviewedAt", r.updated_at as "updatedAt"
    from public.pim_attribute_reviews r
    join public.attributes a on a.id = r.attribute_id
    join public.attribute_values av on av.id = r.attribute_value_id
    where r.product_id = ${productId}::uuid
    order by a.code
  `);

  const published = await getPublishedAttributesForProduct(productId);
  const publishedByCode = new Map(published.map((p) => [p.attributeSlug, p]));

  const allPav = await db.execute(sql`
    select a.code as "attributeCode", av.display_value as "value", pav.attribute_value_id::text as "attributeValueId", pav.attribute_id::text as "attributeId"
    from public.product_attribute_values pav
    join public.attributes a on a.id = pav.attribute_id
    join public.attribute_values av on av.id = pav.attribute_value_id
    where pav.product_id = ${productId}::uuid
    order by a.code
  `);

  const identities = allPav.map((r) => ({ productId, attributeId: r.attributeId, attributeValueId: r.attributeValueId }));
  const eligibilityMap = identities.length > 0 ? await evaluatePublicationEligibilityBatch(db, identities) : new Map();

  const perAttribute = allPav.map((row) => {
    const key = `${productId}:${row.attributeId}:${row.attributeValueId}`;
    const eligResult = eligibilityMap.get(key);
    const reviewRow = allReviews.find((r) => r.attributeCode === row.attributeCode && r.value === row.value);
    const publishedRow = publishedByCode.get(row.attributeCode);
    return {
      attributeCode: row.attributeCode,
      value: row.value,
      reviewState: reviewRow ? reviewRow.reviewStatus : null,
      reviewedAt: reviewRow ? reviewRow.reviewedAt : null,
      published: !!publishedRow,
      eligible: eligResult ? eligResult.eligible : null,
      blockReasons: eligResult ? eligResult.reasonCodes : null,
    };
  });

  return {
    sku,
    slug,
    found: true,
    correlationTag: computeProductCorrelationTag(productId),
    membershipCount: (await getActiveCanaryMembership(productId)).length,
    publishedCount: published.length,
    perAttribute,
  };
}

out.product0117 = await productReconciliation("tubo-pvc-branco-roscavel-1-2-krona-6m", "0117");

const pvcb5mVariant = await db.execute(sql`select p.slug as "slug" from public.product_variants v join public.products p on p.id = v.product_id where v.sku = 'PVCB5M' limit 1`);
out.product_PVCB5M = pvcb5mVariant[0]?.slug ? await productReconciliation(pvcb5mVariant[0].slug, "PVCB5M") : { sku: "PVCB5M", found: false };

// ---- Risk-based sample candidates: real current state ----
const approvedNow = await db.execute(sql`
  select v.sku, p.slug, a.code as "attributeCode", av.display_value as "value", r.reviewed_at as "reviewedAt"
  from public.pim_attribute_reviews r
  join public.products p on p.id = r.product_id
  join public.product_variants v on v.product_id = p.id
  join public.attributes a on a.id = r.attribute_id
  join public.attribute_values av on av.id = r.attribute_value_id
  where r.status = 'approved'
  order by r.reviewed_at desc nulls last
  limit 10
`);
out.approvedNow = approvedNow;

const rejectedNow = await db.execute(sql`
  select v.sku, p.slug, a.code as "attributeCode", av.display_value as "value", r.reviewed_at as "reviewedAt"
  from public.pim_attribute_reviews r
  join public.products p on p.id = r.product_id
  join public.product_variants v on v.product_id = p.id
  join public.attributes a on a.id = r.attribute_id
  join public.attribute_values av on av.id = r.attribute_value_id
  where r.status = 'rejected'
  order by r.reviewed_at desc nulls last
  limit 10
`);
out.rejectedNow = rejectedNow;

console.log(JSON.stringify(out, null, 2));
process.exit(0);
