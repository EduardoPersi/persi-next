import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";

if(!process.argv.includes("--staging")||!process.argv.includes("--read-only"))throw new Error("Exige --staging --read-only.");
const ids=[4462,4925,5465,5678,11531,14042,14703,17227,18878,21166,29059,29441,29917],windowStart="2026-08-26T22:47:25.843Z",env=readPrivateEnvironment(),woo=new WooReadOnlyExtractor(env),sql=postgres(stagingDirectUrl(env.stagingPassword),{ssl:"require",prepare:false,max:1});
try{
  const products=[];for(const id of ids)products.push((await woo.get(`products/${id}`)).data);
  const mappings=await sql`select m.external_id::int id,m.source_changed_at::text from external_mappings m where m.system='woocommerce' and m.entity_type='product' and m.external_id=any(${ids.map(String)}::text[])`;
  const map=new Map(mappings.map(item=>[item.id,item.source_changed_at?new Date(item.source_changed_at).toISOString():null])),sourceChangedAtValid=products.every(product=>map.get(product.id)===new Date(`${product.date_modified_gmt}Z`).toISOString());
  const [effects]=await sql`select
    (select count(*)::int from inventory_movements im join inventory_levels il on il.id=im.inventory_level_id join product_variants v on v.id=il.product_variant_id join external_mappings m on m.internal_id=v.product_id and m.system='woocommerce' and m.entity_type='product' where m.external_id=any(${ids.map(String)}::text[]) and im.created_at>=${windowStart}) inventory_movements,
    (select count(*)::int from price_history ph join prices pr on pr.id=ph.price_id join product_variants v on v.id=pr.product_variant_id join external_mappings m on m.internal_id=v.product_id and m.system='woocommerce' and m.entity_type='product' where m.external_id=any(${ids.map(String)}::text[]) and ph.changed_at>=${windowStart}) price_history`;
  console.log(JSON.stringify({ids,windowStart,sourceChangedAtValid,artificialInventoryMovements:effects.inventory_movements,priceHistoryDuringWindow:effects.price_history,wooRequests:woo.requests},null,2));
  if(!sourceChangedAtValid||effects.inventory_movements!==0||effects.price_history!==0)process.exitCode=1;
}finally{await sql.end({timeout:5});}
