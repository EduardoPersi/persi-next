import fs from "node:fs";
import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl, STAGING_PROJECT_REF } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";
import { CatalogImporter } from "./import.mjs";
import { mapSellableItems } from "./map.mjs";

if (!process.argv.includes("--staging") || !process.argv.includes("--approved-gate-a")) throw new Error("Exige --staging --approved-gate-a.");
const discovery=JSON.parse(fs.readFileSync("supabase/.temp/catalog-import/discovery.json","utf8"));
const ids=discovery.selected.slice(0,10).map((item)=>item.wooId); if(ids.length!==10) throw new Error("Amostra representativa incompleta.");
const env=readPrivateEnvironment(); const extractor=new WooReadOnlyExtractor(env);
const sql=postgres(stagingDirectUrl(env.stagingPassword),{max:4,prepare:false,ssl:"require",connect_timeout:15});
const started=performance.now();
async function size(){const [row]=await sql`select pg_database_size(current_database())::bigint bytes`;return BigInt(row.bytes);}
async function counts(){const [row]=await sql`select
  (select count(*) from public.products)::int products,(select count(*) from public.product_variants)::int variants,
  (select count(*) from public.external_mappings)::int mappings,(select count(*) from public.brands)::int brands,
  (select count(*) from public.categories)::int categories,(select count(*) from public.media_assets)::int media,
  (select count(*) from public.prices)::int prices,(select count(*) from public.inventory_movements)::int movements`;return row;}
try{
 const [identity]=await sql`select current_database() database,inet_server_addr() address`; if(identity.database!=="postgres")throw new Error("Banco inesperado.");
 const beforeSize=await size(), beforeCounts=await counts();
 const [categories,brands]=await Promise.all([extractor.all("products/categories"),extractor.all("products/brands")]);
 const products=[];for(const id of ids){const response=await extractor.get(`products/${id}`);products.push(response.data);}
 const importer=new CatalogImporter(sql,{categories,brands});
 const first=[];for(const product of products)first.push({externalId:product.id,...await importer.importProduct(product)});
 if(first.some((item)=>item.status!=="imported"))throw new Error(`Primeiro lote com conflito: ${JSON.stringify(first)}`);
 const afterFirstSize=await size(), firstCounts=await counts();
 const second=[];for(const product of products)second.push({externalId:product.id,...await importer.importProduct(product)});
 const afterSecondSize=await size(), secondCounts=await counts();
 const target=products[0];const [mapped]=await sql`select internal_id from public.external_mappings where system='woocommerce' and entity_type='product' and external_id=${String(target.id)}`;
 await sql`update public.products set name=name||' [UPDATE TEST]' where id=${mapped.internal_id}`;
 await importer.importProduct(target);
 const [restored]=await sql`select name from public.products where id=${mapped.internal_id}`; if(restored.name!==target.name)throw new Error("Update controlado não restaurado.");
 const reconciliation=[];
 for(const product of products){const items=mapSellableItems(product,[]);const [row]=await sql`select p.name,p.slug,
   count(distinct v.id)::int variants,count(distinct pc.category_id)::int categories,count(distinct pm.id)::int media,
   array_agg(distinct v.sku_normalized) skus,array_agg(distinct v.gtin) gtins
   from public.external_mappings m join public.products p on p.id=m.internal_id
   join public.product_variants v on v.product_id=p.id left join public.product_categories pc on pc.product_id=p.id left join public.product_media pm on pm.product_id=p.id
   where m.system='woocommerce' and m.entity_type='product' and m.external_id=${String(product.id)} group by p.id`;
   const expectedSku=items[0].skuNormalized;const expectedGtin=items[0].gtin;
   const differences=[];if(row.name!==product.name)differences.push('name');if(row.slug!==product.slug)differences.push('slug');if(row.variants!==1)differences.push('variants');if(row.categories!==(product.categories?.length??0))differences.push('categories');if(row.media!==(product.images?.length??0))differences.push('media');if(!row.skus.includes(expectedSku))differences.push('sku');if(expectedGtin&&!row.gtins.includes(expectedGtin))differences.push('gtin');
   reconciliation.push({wooId:product.id,sku:expectedSku,expected:{variants:1,categories:product.categories?.length??0,media:product.images?.length??0,gtin:expectedGtin},actual:{variants:row.variants,categories:row.categories,media:row.media},differences});}
 const critical=reconciliation.reduce((sum,item)=>sum+item.differences.length,0);
 console.log(JSON.stringify({target:`persi-staging:${STAGING_PROJECT_REF}`,source:"WooCommerce READ ONLY",ids,first,second,idempotency:{beforeCounts,firstCounts,secondCounts,deltaSecond:Object.fromEntries(Object.keys(secondCounts).map((key)=>[key,secondCounts[key]-firstCounts[key]]))},databaseSize:{before:beforeSize.toString(),afterFirst:afterFirstSize.toString(),afterSecond:afterSecondSize.toString()},reconciliation,criticalDifferences:critical,performance:{requests:extractor.requests,retries:extractor.retries,durationMs:Math.round(performance.now()-started),transactions:importer.transactions}},null,2));
 if(critical)process.exitCode=1;
}finally{await sql.end({timeout:5});}
