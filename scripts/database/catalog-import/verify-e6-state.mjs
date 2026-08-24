import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl, STAGING_PROJECT_REF } from "./config.mjs";

if(!process.argv.includes("--staging"))throw new Error("Exige --staging.");
const sql=postgres(stagingDirectUrl(readPrivateEnvironment().stagingPassword),{max:1,prepare:false,ssl:"require",connect_timeout:15});
try{
  const [result]=await sql`select
    ${`persi-staging:${STAGING_PROJECT_REF}`} target,
    pg_database_size(current_database())::bigint database_bytes,
    (select count(*) from public.products)::int products,
    (select count(*) from public.product_variants)::int variants,
    (select count(*) from public.product_variants where sku is null or btrim(sku)='')::int sku_missing,
    (select count(*) from (select sku_normalized from public.product_variants group by sku_normalized having count(*)>1)x)::int sku_duplicates,
    (select count(*) from public.product_variants where gtin is null)::int gtin_null,
    (select count(*) from (select gtin from public.product_variants where gtin is not null group by gtin having count(*)>1)x)::int gtin_duplicates,
    (select count(*) from public.prices)::int prices,
    (select count(*) from public.prices where list_amount_minor<0 or sale_amount_minor<0)::int invalid_prices,
    (select count(*) from public.inventory_levels)::int inventory_levels,
    (select count(*) from public.inventory_movements)::int inventory_movements,
    (select count(*) from public.brands)::int brands,
    (select count(*) from public.categories)::int categories,
    (select count(*) from public.media_assets)::int media_assets,
    (select count(*) from public.product_media)::int product_media,
    (select count(*) from public.attributes)::int attributes,
    (select count(*) from public.attribute_values)::int attribute_values,
    (select count(*) from public.product_attribute_values)::int assignments,
    (select count(*) from public.measurement_components)::int measurement_components,
    (select count(*) from public.external_mappings where system='woocommerce')::int woo_mappings`;
  console.log(JSON.stringify({...result,database_bytes:String(result.database_bytes)},null,2));
}finally{await sql.end({timeout:5});}
