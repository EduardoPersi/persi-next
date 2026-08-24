import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";
import { CatalogImporter } from "./import.mjs";
const wooId=9865,env=readPrivateEnvironment(),extractor=new WooReadOnlyExtractor(env),sql=postgres(stagingDirectUrl(env.stagingPassword),{max:2,prepare:false,ssl:"require"});
try{const [productResponse,categories,brands]=await Promise.all([extractor.get(`products/${wooId}`),extractor.all("products/categories"),extractor.all("products/brands")]);const [target]=await sql`select internal_id from public.external_mappings where system='woocommerce' and entity_type='product' and external_id=${String(wooId)}`;
  const [extraPim]=await sql`select av.attribute_id,av.id value_id from public.attribute_values av where not exists(select 1 from public.product_attribute_values pav where pav.product_id=${target.internal_id} and pav.attribute_value_id=av.id) limit 1`;
  const [extraMedia]=await sql`select id from public.media_assets ma where not exists(select 1 from public.product_media pm where pm.product_id=${target.internal_id} and pm.media_asset_id=ma.id) limit 1`;
  if(!extraPim||!extraMedia)throw new Error("Fixtures compartilhadas insuficientes");
  await sql.begin(async(tx)=>{await tx`insert into public.product_attribute_values(product_id,attribute_id,attribute_value_id) values(${target.internal_id},${extraPim.attribute_id},${extraPim.value_id})`;await tx`insert into public.product_media(product_id,media_asset_id,role,sort_order) values(${target.internal_id},${extraMedia.id},'gallery',999)`;});
  const importer=new CatalogImporter(sql,{categories,brands});await importer.importProduct(productResponse.data);
  const [remaining]=await sql`select (select count(*) from public.product_attribute_values where product_id=${target.internal_id} and attribute_value_id=${extraPim.value_id})::int pim,(select count(*) from public.product_media where product_id=${target.internal_id} and media_asset_id=${extraMedia.id})::int media`;
  console.log(JSON.stringify({pimAssignmentRemoved:remaining.pim===0,globalPimDefinitionPreserved:Boolean((await sql`select id from public.attribute_values where id=${extraPim.value_id}`)[0]),obsoleteMediaRelationshipRemoved:remaining.media===0,mediaAssetPreserved:Boolean((await sql`select id from public.media_assets where id=${extraMedia.id}`)[0]),writes:importer.metrics}));if(remaining.pim||remaining.media)process.exitCode=1;
}finally{await sql.end({timeout:5});}
