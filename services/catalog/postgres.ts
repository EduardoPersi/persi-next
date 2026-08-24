import "server-only";

import { sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db/connection";
import type { CatalogListOptions, CatalogPage, CatalogProduct } from "@/lib/catalog/domain";
import { mapPostgresProductRow, type CatalogProductRow } from "@/lib/catalog/postgresMapper";

const aggregateSelect=sql`select pm.external_id::int as "externalId",p.id::text as "internalId",p.slug,p.name,p.short_description as "shortDescription",p.description,p.status,p.published_at as "publishedAt",v.sku,v.gtin,pr.currency,pr.list_amount_minor::text as "regularMinor",pr.sale_amount_minor::text as "saleMinor",pr.sale_valid_from as "saleValidFrom",pr.sale_valid_to as "saleValidTo",coalesce(il.quantity_available,0)::text as "quantityAvailable",
  case when b.id is null then null else jsonb_build_object('externalId',bm.external_id::int,'name',b.name,'slug',b.slug) end brand,
  coalesce((select jsonb_agg(jsonb_build_object('externalId',cm.external_id::int,'name',c.name,'slug',c.slug) order by cm.external_id) from product_categories pc join categories c on c.id=pc.category_id join external_mappings cm on cm.internal_id=c.id and cm.system='woocommerce' and cm.entity_type='category' where pc.product_id=p.id),'[]') categories,
  coalesce((select jsonb_agg(jsonb_build_object('externalId',mm.external_id::int,'url',ma.public_url,'alt',coalesce(ma.alt_text,''),'title',ma.title,'role',pmedia.role,'position',pmedia.sort_order) order by pmedia.sort_order) from product_media pmedia join media_assets ma on ma.id=pmedia.media_asset_id left join external_mappings mm on mm.internal_id=ma.id and mm.system='woocommerce' and mm.entity_type='media_asset' where pmedia.product_id=p.id and pmedia.variant_id is null),'[]') images,
  coalesce((select jsonb_agg(jsonb_build_object('code',a.code,'name',a.name,'value',av.display_value) order by a.code,av.display_value) from product_attribute_values pav join attributes a on a.id=pav.attribute_id join attribute_values av on av.id=pav.attribute_value_id where pav.product_id=p.id),'[]') attributes
  from products p join external_mappings pm on pm.internal_id=p.id and pm.system='woocommerce' and pm.entity_type='product' join product_variants v on v.product_id=p.id join prices pr on pr.product_variant_id=v.id and pr.status='active' join inventory_levels il on il.product_variant_id=v.id left join brands b on b.id=p.brand_id left join external_mappings bm on bm.internal_id=b.id and bm.system='woocommerce' and bm.entity_type='brand'`;

async function one(where:ReturnType<typeof sql>):Promise<CatalogProduct|undefined>{const rows=await getDatabase().execute<CatalogProductRow>(sql`${aggregateSelect} where ${where} limit 1`);return rows[0]?mapPostgresProductRow(rows[0]):undefined;}
export const getPostgresProductBySlug=(slug:string)=>one(sql`p.slug=${slug}`);
export const getPostgresProductBySku=(sku:string)=>one(sql`v.sku_normalized=upper(btrim(${sku}))`);
export const getPostgresProductByWooId=(id:number)=>one(sql`pm.external_id=${String(id)}`);

async function list(where:ReturnType<typeof sql>,options:CatalogListOptions={},customOrdering?:ReturnType<typeof sql>):Promise<CatalogPage<CatalogProduct>>{
  const page=Math.max(1,options.page??1),perPage=Math.min(100,Math.max(1,options.perPage??16)),offset=(page-1)*perPage,direction=options.order==="asc"?sql`asc`:sql`desc`,ordering=customOrdering??(options.orderBy==="price"?sql`pr.list_amount_minor`:options.orderBy==="title"?sql`p.name`:options.orderBy==="id"?sql`pm.external_id`:sql`p.published_at`),availability=customOrdering?sql``:options.availabilityFirst===false?sql``:sql`il.quantity_available desc,`;
  const countRows=await getDatabase().execute<{count:string}>(sql`select count(*)::text count from products p join external_mappings pm on pm.internal_id=p.id and pm.system='woocommerce' and pm.entity_type='product' join product_variants v on v.product_id=p.id join prices pr on pr.product_variant_id=v.id and pr.status='active' join inventory_levels il on il.product_variant_id=v.id left join brands b on b.id=p.brand_id left join external_mappings bm on bm.internal_id=b.id and bm.system='woocommerce' and bm.entity_type='brand' where ${where}`);
  const rows=await getDatabase().execute<CatalogProductRow>(sql`${aggregateSelect} where ${where} order by ${availability}${ordering} ${direction},p.id limit ${perPage} offset ${offset}`);const total=Number(countRows[0]?.count??0);return{items:rows.map(mapPostgresProductRow),total,page,perPage};
}
export const getPostgresProductsByCategory=(externalId:number,options?:CatalogListOptions)=>list(sql`exists(select 1 from product_categories fpc join external_mappings fcm on fcm.internal_id=fpc.category_id and fcm.system='woocommerce' and fcm.entity_type='category' where fpc.product_id=p.id and fcm.external_id=${String(externalId)})`,options);
export const getPostgresProductsByBrand=(externalId:number,options?:CatalogListOptions)=>list(sql`bm.external_id=${String(externalId)}`,options);
export const searchPostgresProducts=(term:string,options?:CatalogListOptions)=>list(
  sql`p.id in (select product_id from public.catalog_search(${term},100))`,
  {...options,order:"desc",availabilityFirst:false},
  sql`(select score from public.catalog_search(${term},100) ranked where ranked.product_id=p.id)`,
);
