import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { getDatabase } from "@/lib/db";

export const PIM_STATUSES = ["raw", "normalized", "needs_enrichment", "draft", "ai_suggested", "needs_review", "approved", "rejected", "published"] as const;
export type PimStatus = (typeof PIM_STATUSES)[number];

export type PimProductFilters = { query?: string; brand?: string; category?: string; status?: string; image?: string; gtin?: string; issue?: string; page?: number; pageSize?: number };
export type PimProductListItem = { id:string; name:string; sku:string; gtin:string|null; brand:string|null; category:string|null; imageUrl:string|null; priceMinor:string|null; currency:string|null; stock:string|null; status:PimStatus; pendingCount:number; updatedAt:Date };
export type PimAttributeItem = { id:string; name:string; value:string; source:string; status:string; confidence:string|null };
export type PimEditorialContent = { commercialName:string|null; shortDescription:string|null; description:string|null; bulletPoints:string[]; application:string|null; specifications:string|null; seoTitle:string|null; metaDescription:string|null; searchTerms:string[]; imageAltText:string|null };
export type PimAuditItem = { id:string; operation:string; actorReference:string; reason:string|null; createdAt:Date };
export type PimProductDetail = PimProductListItem & { slug:string; sourceShortDescription:string|null; sourceDescription:string|null; salePriceMinor:string|null; source:string; lastSyncedAt:Date|null; version:string; draft:PimEditorialContent; approved:PimEditorialContent|null; attributes:PimAttributeItem[]; suggestions:Array<{id:string;fieldName:string;value:string;source:string;status:string;confidence:string|null}>; history:PimAuditItem[] };
export type PimQueueCounts = { needsEnrichment:number; draft:number; needsReview:number; rejected:number; aiSuggested:number; ambiguous:number; unmapped:number; missingData:number; readyForApproval:number; approved:number };

function safePage(value: number | undefined): number { return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1; }
function safePageSize(value: number | undefined): number { return [25, 50, 100].includes(Number(value)) ? Number(value) : 25; }

function filtersSql(filters: PimProductFilters): SQL[] {
  const conditions: SQL[] = [];
  const query = filters.query?.trim();
  if (query) conditions.push(sql`(p.name ilike ${`%${query}%`} or v.sku_normalized = ${query.toUpperCase()} or v.gtin = ${query})`);
  if (filters.brand) conditions.push(sql`p.brand_id = ${filters.brand}::uuid`);
  if (filters.category) conditions.push(sql`exists(select 1 from product_categories fpc where fpc.product_id=p.id and fpc.category_id=${filters.category}::uuid)`);
  if (PIM_STATUSES.includes(filters.status as PimStatus)) conditions.push(sql`coalesce(pp.workflow_status::text,'raw')=${filters.status}`);
  if (filters.image === "with") conditions.push(sql`pm.public_url is not null`);
  if (filters.image === "without") conditions.push(sql`pm.public_url is null`);
  if (filters.gtin === "with") conditions.push(sql`v.gtin is not null`);
  if (filters.gtin === "without") conditions.push(sql`v.gtin is null`);
  if (filters.issue === "needs_review") conditions.push(sql`(coalesce(pp.workflow_status::text,'raw')='needs_review' or coalesce(pending.count,0)>0)`);
  if (filters.issue === "ambiguous") conditions.push(sql`exists(select 1 from external_mappings em where em.internal_id=p.id and em.status='conflict')`);
  if (filters.issue === "unmapped") conditions.push(sql`not exists(select 1 from external_mappings em where em.internal_id=p.id and em.entity_type='product')`);
  if (filters.issue === "missing") conditions.push(sql`(v.gtin is null or pm.public_url is null)`);
  return conditions;
}

const baseJoins = sql`
  join lateral (select * from product_variants x where x.product_id=p.id order by x.created_at,x.id limit 1) v on true
  left join brands b on b.id=p.brand_id left join categories c on c.id=p.primary_category_id
  left join pim_product_profiles pp on pp.product_id=p.id
  left join lateral (select ma.public_url from product_media x join media_assets ma on ma.id=x.media_asset_id where x.product_id=p.id order by (x.role='primary') desc,x.sort_order,x.id limit 1) pm on true
  left join lateral (select count(*)::int count from pim_suggestions s where s.product_id=p.id and s.status='needs_review') pending on true`;

export async function listPimProducts(filters: PimProductFilters) {
  const page=safePage(filters.page), pageSize=safePageSize(filters.pageSize), conditions=filtersSql(filters);
  const where = conditions.length ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
  const db=getDatabase();
  const rows=await db.execute(sql`select p.id,p.name,v.sku,v.gtin,b.name brand,c.name category,pm.public_url "imageUrl",
    pr.list_amount_minor::text "priceMinor",pr.currency,il.quantity_available::text stock,coalesce(pp.workflow_status::text,'raw') status,
    coalesce(pending.count,0)::int "pendingCount",coalesce(pp.updated_at,p.updated_at) "updatedAt" from products p ${baseJoins}
    left join lateral (select x.list_amount_minor,x.currency from prices x where x.product_variant_id=v.id and x.status='active' order by x.valid_from desc limit 1) pr on true
    left join lateral (select sum(x.quantity_available)::text quantity_available from inventory_levels x where x.product_variant_id=v.id) il on true
    ${where} order by coalesce(pp.updated_at,p.updated_at) desc,p.id limit ${pageSize} offset ${(page-1)*pageSize}`);
  const countRows=await db.execute(sql`select count(*)::int total from products p ${baseJoins} ${where}`);
  return { items: rows as unknown as PimProductListItem[], total:Number((countRows as unknown as Array<{total:number}>)[0]?.total??0), page, pageSize };
}

export async function getPimProduct(id:string):Promise<PimProductDetail|null>{
  const db=getDatabase();
  const rows=await db.execute(sql`select p.id,p.name,p.slug,p.short_description "sourceShortDescription",p.description "sourceDescription",v.sku,v.gtin,b.name brand,c.name category,pm.public_url "imageUrl",
    pr.list_amount_minor::text "priceMinor",pr.sale_amount_minor::text "salePriceMinor",pr.currency,il.quantity_available::text stock,
    coalesce(pp.workflow_status::text,'raw') status,coalesce(pending.count,0)::int "pendingCount",coalesce(pp.updated_at,p.updated_at) "updatedAt",
    'woocommerce' source,em.source_changed_at "lastSyncedAt",coalesce(pp.version,0)::text version,
    jsonb_build_object('commercialName',pp.commercial_name,'shortDescription',pp.short_description,'description',pp.description,
      'bulletPoints',coalesce(pp.bullet_points,'{}'),'application',pp.application,'specifications',pp.specifications,'seoTitle',pp.seo_title,
      'metaDescription',pp.meta_description,'searchTerms',coalesce(pp.search_terms,'{}'),'imageAltText',pp.image_alt_text) draft,
    pp.approved_content approved from products p ${baseJoins}
    left join lateral (select x.list_amount_minor,x.sale_amount_minor,x.currency from prices x where x.product_variant_id=v.id and x.status='active' order by x.valid_from desc limit 1) pr on true
    left join lateral (select sum(x.quantity_available)::text quantity_available from inventory_levels x where x.product_variant_id=v.id) il on true
    left join lateral (select x.source_changed_at from external_mappings x where x.internal_id=p.id and x.entity_type='product' order by x.updated_at desc limit 1) em on true where p.id=${id}::uuid limit 1`);
  const product=(rows as unknown as PimProductDetail[])[0]; if(!product)return null;
  const attributes=await db.execute(sql`select av.id,a.name,av.display_value value,coalesce(r.source::text,'woocommerce') source,coalesce(r.status::text,'approved') status,r.confidence::text confidence
    from product_attribute_values pav join attributes a on a.id=pav.attribute_id join attribute_values av on av.id=pav.attribute_value_id
    left join pim_attribute_reviews r on r.product_id=pav.product_id and r.attribute_id=pav.attribute_id and r.attribute_value_id=pav.attribute_value_id
    where pav.product_id=${id}::uuid order by a.sort_order,a.name,av.display_value`);
  const suggestions=await db.execute(sql`select id,field_name,suggested_value value_placeholder,source::text,status::text,confidence::text from pim_suggestions where product_id=${id}::uuid order by created_at desc`);
  product.attributes=attributes as unknown as PimAttributeItem[];
  product.suggestions=(suggestions as unknown as Array<{id:string;field_name:string;value_placeholder:string;source:string;status:string;confidence:string|null}>).map(s=>({id:s.id,fieldName:s.field_name,value:s.value_placeholder,source:s.source,status:s.status,confidence:s.confidence}));
  const history=await db.execute(sql`select id,operation,actor_reference "actorReference",reason,created_at "createdAt" from pim_audit_log
    where product_id=${id}::uuid and entity_type='editorial_profile' order by created_at desc,id desc limit 100`);
  product.history=history as unknown as PimAuditItem[];
  return product;
}

export async function listPimFilterOptions(){const db=getDatabase();const [brands,categories]=await Promise.all([db.execute(sql`select id,name from brands where status='active' order by name`),db.execute(sql`select id,name from categories where status='active' order by name`)]);return {brands:brands as unknown as Array<{id:string;name:string}>,categories:categories as unknown as Array<{id:string;name:string}>};}

export async function getPimQueueCounts(): Promise<PimQueueCounts> {
  const rows = await getDatabase().execute(sql`
    select
      count(*) filter (where coalesce(pp.workflow_status::text,'raw')='needs_review' or coalesce(pending.count,0)>0)::int "needsReview",
      count(*) filter (where coalesce(pp.workflow_status::text,'raw')='needs_enrichment')::int "needsEnrichment",
      count(*) filter (where pp.workflow_status::text='draft')::int draft,
      count(*) filter (where pp.workflow_status::text='rejected')::int rejected,
      count(*) filter (where coalesce(pp.workflow_status::text,'raw')='ai_suggested' or coalesce(pending.ai_count,0)>0)::int "aiSuggested",
      count(*) filter (where coalesce(conflicts.count,0)>0)::int ambiguous,
      count(*) filter (where not exists(select 1 from external_mappings em where em.internal_id=p.id and em.entity_type='product'))::int unmapped,
      count(*) filter (where v.gtin is null or pm.public_url is null)::int "missingData",
      count(*) filter (where coalesce(pp.workflow_status::text,'raw')='needs_enrichment')::int "readyForApproval",
      count(*) filter (where pp.workflow_status::text='approved')::int approved
    from products p
    join lateral (select x.gtin from product_variants x where x.product_id=p.id order by x.created_at,x.id limit 1) v on true
    left join pim_product_profiles pp on pp.product_id=p.id
    left join lateral (select ma.public_url from product_media x join media_assets ma on ma.id=x.media_asset_id where x.product_id=p.id order by (x.role='primary') desc,x.sort_order,x.id limit 1) pm on true
    left join lateral (select count(*)::int count,count(*) filter(where s.source='ai')::int ai_count from pim_suggestions s where s.product_id=p.id and s.status='needs_review') pending on true
    left join lateral (select count(*)::int count from external_mappings em where em.internal_id=p.id and em.status='conflict') conflicts on true`);
  const counts = (rows as unknown as PimQueueCounts[])[0];
  return counts ?? { needsEnrichment:0, draft:0, needsReview:0, rejected:0, aiSuggested:0, ambiguous:0, unmapped:0, missingData:0, readyForApproval:0, approved:0 };
}
