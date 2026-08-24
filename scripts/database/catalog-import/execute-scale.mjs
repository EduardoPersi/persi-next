import fs from "node:fs";
import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl, STAGING_PROJECT_REF } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";
import { CatalogImporter } from "./import.mjs";
import { ATTRIBUTE_RULES, resolveGtin } from "./normalize.mjs";
import { mapSellableItems } from "./map.mjs";
import { createWriteMetrics } from "./sync.mjs";

const count=Number(process.argv.find((x)=>x.startsWith("--count="))?.slice(8));
if(![50,100].includes(count)||!process.argv.includes("--staging")||!process.argv.includes("--approved-scale"))throw new Error("Exige --count=50|100 --staging --approved-scale.");
const baseIds=[9865,11908,19622,5710,5765,6100,6106,9843,9846,9850];
const percentile=(values,p)=>values.length?values[Math.min(values.length-1,Math.ceil(values.length*p)-1)]:0;
const elapsed=(start)=>Math.round(performance.now()-start);
const snapshotMetrics=(metrics)=>JSON.parse(JSON.stringify(metrics));
function features(product){
  const price=Number(product.regular_price||product.sale_price||0);const text=[product.name,...(product.attributes??[]).flatMap((a)=>a.options??[])].join(" ");
  return new Set([`brand:${product.brands?.[0]?.id??"none"}`,...(product.categories??[]).map((x)=>`category:${x.id}`),...(product.attributes??[]).map((x)=>`attribute:${x.slug}`),`price:${price<50?"low":price<500?"mid":"high"}`,product.global_unique_id?"gtin:yes":"gtin:no",product.sale_price?"sale:yes":"sale:no",`stock:${product.stock_status}`,`images:${(product.images?.length??0)>1?"many":"one"}`,`attributes:${(product.attributes?.length??0)>=4?"many":"few"}`,/\bmm\b/i.test(text)?"measure:metric":"measure:no-metric",/(?:\"|pol\b)/i.test(text)?"measure:imperial":"measure:no-imperial"]);
}
function selectStratified(products,target){
  const byId=new Map(products.map((x)=>[x.id,x]));const selected=baseIds.map((id)=>byId.get(id)).filter(Boolean);const selectedIds=new Set(selected.map((x)=>x.id));const covered=new Set(selected.flatMap((x)=>[...features(x)]));
  while(selected.length<target){let best=null,bestScore=-1;for(const product of products){if(selectedIds.has(product.id)||product.type!=="simple"||!String(product.sku??"").trim())continue;const novelty=[...features(product)].filter((x)=>!covered.has(x)).length;const score=novelty*100+(product.attributes?.length??0)*4+(product.images?.length??0)*2+(product.sale_price?8:0)+(product.stock_status==="outofstock"?7:0)+(resolveGtin(product).value?3:0);if(score>bestScore||(score===bestScore&&product.id<(best?.id??Infinity))){best=product;bestScore=score;}}
    if(!best)throw new Error("Amostra estratificada incompleta");selected.push(best);selectedIds.add(best.id);for(const value of features(best))covered.add(value);
  }return selected;
}
async function databaseStats(sql){
  const [size]=await sql`select pg_database_size(current_database())::bigint bytes`;
  const relations=await sql`select relname,pg_total_relation_size(c.oid)::bigint total_bytes,pg_relation_size(c.oid)::bigint table_bytes,pg_indexes_size(c.oid)::bigint index_bytes from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by pg_total_relation_size(c.oid) desc limit 12`;
  return{bytes:String(size.bytes),relations};
}
async function targetCounts(sql,ids){
  const rows=await sql`select m.external_id,p.id product_id from public.external_mappings m join public.products p on p.id=m.internal_id where m.system='woocommerce' and m.entity_type='product' and m.external_id in ${sql(ids.map(String))}`;
  const productIds=rows.map((x)=>x.product_id);if(!productIds.length)return{products:0,variants:0,media:0,pim:0};
  const [counts]=await sql`select ${rows.length}::int products,(select count(*) from public.product_variants where product_id in ${sql(productIds)})::int variants,(select count(*) from public.product_media where product_id in ${sql(productIds)})::int media,(select count(*) from public.product_attribute_values where product_id in ${sql(productIds)})::int pim`;
  return counts;
}
async function reconcile(sql,products){
  const rows=[];let mappedAssignments=0,unmapped=0,ambiguous=0,media=0,gtinPresent=0,gtinMissing=0;
  for(const source of products){const item=mapSellableItems(source,[])[0];const [target]=await sql`select p.id,p.name,p.slug,p.status,p.primary_category_id,v.id variant_id,v.sku_normalized,v.gtin,pr.list_amount_minor,pr.sale_amount_minor,pr.sale_valid_from,pr.sale_valid_to,il.quantity_on_hand from public.external_mappings m join public.products p on p.id=m.internal_id join public.product_variants v on v.product_id=p.id left join public.prices pr on pr.product_variant_id=v.id and pr.status='active' left join public.inventory_levels il on il.product_variant_id=v.id where m.system='woocommerce' and m.entity_type='product' and m.external_id=${String(source.id)}`;
    if(!target){rows.push({wooId:source.id,differences:["missing_product"]});continue;}
    const categoryRows=await sql`select m.external_id from public.product_categories pc join public.external_mappings m on m.internal_id=pc.category_id and m.system='woocommerce' and m.entity_type='category' where pc.product_id=${target.id}`;
    const mediaRows=await sql`select m.external_id,pm.role,pm.sort_order from public.product_media pm join public.external_mappings m on m.internal_id=pm.media_asset_id and m.system='woocommerce' and m.entity_type='media_asset' where pm.product_id=${target.id} order by pm.sort_order`;media+=mediaRows.length;
    const pimExpected=(source.attributes??[]).filter((a)=>{const rule=ATTRIBUTE_RULES.get(String(a.slug??"").toLowerCase());if(!rule){unmapped+=(a.options?.length??0);return false;}return rule.entity!=="brand";}).reduce((sum,a)=>sum+(a.options?.length??0),0);mappedAssignments+=pimExpected;
    const [pimActual]=await sql`select count(*)::int count from public.product_attribute_values where product_id=${target.id}`;
    const expected={name:source.name,slug:source.slug,status:source.status==="publish"?"active":"draft",primary:null,sku:item.skuNormalized,gtin:item.gtin,regular:item.regularAmountMinor===null?null:String(item.regularAmountMinor),sale:item.saleAmountMinor===null?null:String(item.saleAmountMinor),saleFrom:item.salePeriod.from,saleTo:item.salePeriod.to,stock:String(item.stockQuantity),categories:(source.categories??[]).map((x)=>String(x.id)).sort(),media:(source.images??[]).map((x)=>String(x.id)),pim:pimExpected};
    const actual={name:target.name,slug:target.slug,status:target.status,primary:target.primary_category_id,sku:target.sku_normalized,gtin:target.gtin,regular:target.list_amount_minor,sale:target.sale_amount_minor,saleFrom:target.sale_valid_from?new Date(target.sale_valid_from).toISOString():null,saleTo:target.sale_valid_to?new Date(target.sale_valid_to).toISOString():null,stock:target.quantity_on_hand,categories:categoryRows.map((x)=>x.external_id).sort(),media:mediaRows.map((x)=>x.external_id),pim:pimActual.count};
    const differences=Object.keys(expected).filter((key)=>JSON.stringify(expected[key])!==JSON.stringify(actual[key]));rows.push({wooId:source.id,sku:item.skuNormalized,differences});if(item.gtin)gtinPresent++;else gtinMissing++;
  }
  const [duplicates]=await sql`select (select count(*) from (select entity_type,external_id from public.external_mappings where system='woocommerce' group by entity_type,external_id having count(*)>1)x)::int mappings,(select count(*)-count(distinct sku_normalized) from public.product_variants)::int variants,(select count(*) from (select product_variant_id,price_list_id from public.prices where status='active' group by product_variant_id,price_list_id having count(*)>1)x)::int prices,(select count(*) from public.inventory_movements)::int movements`;
  return{rows,criticalDifferences:rows.reduce((n,x)=>n+x.differences.length,0),duplicates,coverage:{gtinPresent,gtinMissing,media,totalMedia:media,averageMedia:media/products.length,pimMapped:mappedAssignments,pimUnmapped:unmapped,pimAmbiguous:ambiguous}};
}

const env=readPrivateEnvironment(),extractor=new WooReadOnlyExtractor(env),sql=postgres(stagingDirectUrl(env.stagingPassword),{max:4,prepare:false,ssl:"require",connect_timeout:15});
try{
  const extractionStart=performance.now();const [allProducts,categories,brands]=await Promise.all([extractor.all("products"),extractor.all("products/categories"),extractor.all("products/brands")]);const extractionMs=elapsed(extractionStart);const selected=selectStratified(allProducts,count),ids=selected.map((x)=>String(x.id));
  const before=await databaseStats(sql),importer=new CatalogImporter(sql,{categories,brands}),durations=[];const importStart=performance.now();const first=[];
  for(const product of selected){const start=performance.now();first.push(await importer.importProduct(product));durations.push(elapsed(start));}
  const importMs=elapsed(importStart),firstMetrics=snapshotMetrics(importer.metrics),afterFirst=await databaseStats(sql),counts=await targetCounts(sql,ids);const reconciliationStart=performance.now(),reconciliation=await reconcile(sql,selected),reconciliationMs=elapsed(reconciliationStart);
  importer.metrics=createWriteMetrics();const secondStart=performance.now();for(const product of selected)await importer.importProduct(product);const secondMs=elapsed(secondStart),secondMetrics=snapshotMetrics(importer.metrics),afterSecond=await databaseStats(sql),finalReconciliation=await reconcile(sql,selected);
  const sorted=[...durations].sort((a,b)=>a-b);const result={target:`persi-staging:${STAGING_PROJECT_REF}`,source:"WooCommerce READ ONLY",stage:count,selected:ids,counts,reconciliation,finalReconciliation,idempotency:{first:firstMetrics,second:secondMetrics},database:{before,afterFirst,afterSecond},performance:{requests:extractor.requests,retries:extractor.retries,extractionMs,importMs,reconciliationMs,secondMs,productsPerMinute:Math.round(count/(importMs/60000)*10)/10,p50Ms:percentile(sorted,.5),p95Ms:percentile(sorted,.95)},conflicts:first.filter((x)=>x.status!=="imported")};
  fs.mkdirSync("supabase/.temp/catalog-import",{recursive:true});fs.writeFileSync(`supabase/.temp/catalog-import/gate-${count}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({stage:count,counts,reconciliation:{criticalDifferences:reconciliation.criticalDifferences,duplicates:reconciliation.duplicates,coverage:reconciliation.coverage},finalReconciliation:{criticalDifferences:finalReconciliation.criticalDifferences,duplicates:finalReconciliation.duplicates},idempotency:result.idempotency,database:result.database,performance:result.performance,conflicts:result.conflicts},null,2));
  if(counts.products!==count||counts.variants!==count||reconciliation.criticalDifferences||finalReconciliation.criticalDifferences||result.conflicts.length||Object.values(finalReconciliation.duplicates).some(Number))process.exitCode=1;
}finally{await sql.end({timeout:5});}
