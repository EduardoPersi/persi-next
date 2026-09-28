// A3.7-A-R17-R1B: READ-ONLY reconciliation against real persi-staging,
// using the REAL, unmodified pipeline functions (never a reimplementation).
// Zero writes. Only SELECTs are ever issued by these imported functions.
import { getDatabase } from "../../lib/db/connection.ts";

const { getActiveCanaryMembership, getPublishedAttributesForProduct } = await import("../../lib/pim/publication-read-model.ts");
const { evaluatePublicationEligibilityBatch } = await import("../../lib/pim/publication-eligibility.ts");
const { sql } = await import("drizzle-orm");

const db = getDatabase();

// ---- Section 4: batch reconciliation ----
const batchId = "5cab6afa-72c9-4cdd-b520-5cd4262bc154";
const batchRows = await db.execute(sql`select id::text, kind, status, member_fingerprint, created_at from public.pim_publication_batches where id=${batchId}::uuid`);
const memberRows = await db.execute(sql`select count(*)::int as total, count(*) filter (where state='published')::int as published from public.pim_attribute_publications where batch_id=${batchId}::uuid`);

// ---- Section 5: slug -> productId (same query as defaultResolvePimProductId) ----
const slug = "tubo-pvc-branco-roscavel-1-2-krona-6m";
const slugRows = await db.execute(sql`select id::text as id from public.products where slug = ${slug} limit 1`);
const productId = slugRows[0]?.id ?? null;

const out = { batchRows, memberRows, productId };

if (productId) {
  // ---- Section 6: active canary membership (REAL function) ----
  const membership = await getActiveCanaryMembership(productId);
  out.membership = membership;

  // ---- Section 7: published attributes (REAL function) ----
  const published = await getPublishedAttributesForProduct(productId);
  out.published = published.map((r) => ({ attributeSlug: r.attributeSlug, canonicalValue: r.canonicalValue, publicationState: r.publicationState, batchId: r.batchId }));

  // ---- Section 8: current eligibility (REAL function) over the published identities ----
  if (published.length > 0) {
    const identities = published.map((r) => ({ productId: r.productId, attributeId: r.attributeId, attributeValueId: r.attributeValueId }));
    const eligibility = await evaluatePublicationEligibilityBatch(db, identities);
    out.eligibility = [...eligibility.entries()].map(([key, result]) => ({ key, attributeCode: result.attributeCode, eligible: result.eligible, reasonCodes: result.reasonCodes }));
  }

  // ---- Section 9: admin print reconciliation -- all reviewed attributes for this product ----
  const allReviews = await db.execute(sql`
    select a.code as "attributeCode", r.status::text as "reviewStatus", av.display_value as "value"
    from public.pim_attribute_reviews r
    join public.attributes a on a.id = r.attribute_id
    join public.attribute_values av on av.id = r.attribute_value_id
    where r.product_id = ${productId}::uuid
    order by a.code
  `);
  out.reviewRows = allReviews;

  const allPav = await db.execute(sql`
    select a.code as "attributeCode", av.display_value as "value"
    from public.product_attribute_values pav
    join public.attributes a on a.id = pav.attribute_id
    join public.attribute_values av on av.id = pav.attribute_value_id
    where pav.product_id = ${productId}::uuid
    order by a.code
  `);
  out.allProductAttributeValues = allPav;
}

console.log(JSON.stringify(out, null, 2));
process.exit(0);
