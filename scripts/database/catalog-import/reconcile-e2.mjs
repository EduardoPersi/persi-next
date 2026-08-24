import fs from "node:fs";
import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";
import { ATTRIBUTE_RULES } from "./normalize.mjs";
import { mapSellableItems } from "./map.mjs";

const env=readPrivateEnvironment();const extractor=new WooReadOnlyExtractor(env);const sql=postgres(stagingDirectUrl(env.stagingPassword),{max:2,prepare:false,ssl:"require"});
const discovery=JSON.parse(fs.readFileSync("supabase/.temp/catalog-import/discovery.json","utf8"));const ids=discovery.selected.slice(0,10).map((x)=>x.wooId);
const rows=[];
try{for(const id of ids){const source=(await extractor.get(`products/${id}`)).data;const item=mapSellableItems(source,[])[0];
 const [target]=await sql`select p.id,p.brand_id,v.id variant_id,v.sku_normalized,v.gtin,pr.list_amount_minor,pr.sale_amount_minor,il.quantity_on_hand
 from public.external_mappings m join public.products p on p.id=m.internal_id join public.product_variants v on v.product_id=p.id
 left join public.prices pr on pr.product_variant_id=v.id and pr.status='active' left join public.inventory_levels il on il.product_variant_id=v.id
 where m.system='woocommerce' and m.entity_type='product' and m.external_id=${String(id)}`;
 const categoryMappings=await sql`select m.external_id from public.product_categories pc join public.external_mappings m on m.internal_id=pc.category_id and m.system='woocommerce' and m.entity_type='category' where pc.product_id=${target.id}`;
 const mediaMappings=await sql`select m.external_id from public.product_media pm join public.external_mappings m on m.internal_id=pm.media_asset_id and m.system='woocommerce' and m.entity_type='media_asset' where pm.product_id=${target.id}`;
 const brandMapping=target.brand_id?(await sql`select external_id from public.external_mappings where system='woocommerce' and entity_type='brand' and internal_id=${target.brand_id}`)[0]:null;
 const [pim]=await sql`select count(*)::int count from public.product_attribute_values where product_id=${target.id}`;
 const expectedPim=(source.attributes??[]).filter((a)=>{const rule=ATTRIBUTE_RULES.get(String(a.slug??'').toLowerCase());return rule&&rule.entity!=='brand';}).reduce((sum,a)=>sum+(a.options?.length??0),0);
 const expected={sku:item.skuNormalized,gtin:item.gtin,regular:item.regularAmountMinor===null?null:String(item.regularAmountMinor),sale:item.saleAmountMinor===null?null:String(item.saleAmountMinor),stock:String(item.stockQuantity),brand:source.brands?.[0]?String(source.brands[0].id):null,categories:(source.categories??[]).map((x)=>String(x.id)).sort(),media:(source.images??[]).map((x)=>String(x.id)).sort(),pim:expectedPim};
 const actual={sku:target.sku_normalized,gtin:target.gtin,regular:target.list_amount_minor,sale:target.sale_amount_minor,stock:target.quantity_on_hand,brand:brandMapping?.external_id??null,categories:categoryMappings.map((x)=>x.external_id).sort(),media:mediaMappings.map((x)=>x.external_id).sort(),pim:pim.count};
 const differences=Object.keys(expected).filter((key)=>JSON.stringify(expected[key])!==JSON.stringify(actual[key]));rows.push({wooId:id,sku:item.skuNormalized,expected,actual,differences});}
 const [duplicates]=await sql`select
   (select count(*) from (select entity_type,external_id from public.external_mappings where system='woocommerce' group by entity_type,external_id having count(*)>1) duplicate)::int mapping_duplicates,
   (select count(*)-count(distinct sku_normalized) from public.product_variants)::int sku_duplicates,
   (select count(*) from (select product_variant_id,price_list_id from public.prices where status='active' group by product_variant_id,price_list_id having count(*)>1) duplicate)::int current_price_duplicates,
   (select count(*) from public.inventory_movements)::int movements`;
 const [size]=await sql`select pg_database_size(current_database())::bigint bytes`;
 const critical=rows.reduce((sum,row)=>sum+row.differences.length,0);console.log(JSON.stringify({rows,criticalDifferences:critical,duplicates,databaseSizeBytes:size.bytes,requests:extractor.requests,retries:extractor.retries},null,2));if(critical)process.exitCode=1;
}finally{await sql.end({timeout:5});}
