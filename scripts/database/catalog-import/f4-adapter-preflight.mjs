import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl } from "./config.mjs";
if(!process.argv.includes("--staging")||!process.argv.includes("--read-only"))throw new Error("Exige --staging --read-only.");
const sql=postgres(stagingDirectUrl(readPrivateEnvironment().stagingPassword),{ssl:"require",prepare:false,max:1});
try{
  const types=await sql`select product_type,count(*)::int products,count(*) filter(where variants>1)::int multiple_variants,max(variants)::int max_variants from(select p.product_type,p.id,count(v.id)::int variants from products p join product_variants v on v.product_id=p.id group by p.id)p group by product_type order by product_type`;
  const [coverage]=await sql`select count(*)::int products,count(*) filter(where v.sku is null or btrim(v.sku)='')::int missing_sku,count(*) filter(where p.status<>'active')::int non_active,count(*) filter(where p.catalog_visibility='hidden')::int hidden,count(*) filter(where not p.is_purchasable)::int not_purchasable from products p join lateral(select sku from product_variants where product_id=p.id order by id limit 1)v on true`;
  console.log(JSON.stringify({types,coverage,adapterContract:{currentDefaultVariantOnly:true,productTypeExposed:false,variationsExposed:false,commercialSemanticsExposed:false,tagsExposed:false,categoryBrandMediaExposed:false}},null,2));
}finally{await sql.end({timeout:5});}
