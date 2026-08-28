import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";
import { mapSellableItems } from "./map.mjs";

if(!process.argv.includes("--staging")||!process.argv.includes("--read-only"))throw new Error("Exige --staging --read-only.");
const id=14806,env=readPrivateEnvironment(),woo=new WooReadOnlyExtractor(env),sql=postgres(stagingDirectUrl(env.stagingPassword),{ssl:"require",prepare:false,max:1});
try{const product=(await woo.get(`products/${id}`)).data,item=mapSellableItems(product,[])[0],[row]=await sql`select m.source_changed_at::text,v.sku,pr.list_amount_minor::text regular,pr.sale_amount_minor::text sale from products p join external_mappings m on m.internal_id=p.id and m.system='woocommerce' and m.entity_type='product' join product_variants v on v.product_id=p.id join prices pr on pr.product_variant_id=v.id and pr.status='active' where m.external_id=${String(id)}`;const wooChanged=new Date(`${product.date_modified_gmt}Z`).toISOString(),mappedChanged=row.source_changed_at?new Date(row.source_changed_at).toISOString():null,classification=!mappedChanged||new Date(wooChanged)>new Date(mappedChanged)?"UNSYNCED_SOURCE_CHANGE":"UNKNOWN";console.log(JSON.stringify({wooExternalId:id,sku:row.sku,field:"regular",woo:String(item.regularAmountMinor),postgres:row.regular,wooDateModifiedGmt:wooChanged,sourceChangedAt:mappedChanged,classification,discoveredBy:"DTO_PARITY"},null,2));if(classification!=="UNSYNCED_SOURCE_CHANGE")process.exitCode=1;}finally{await sql.end({timeout:5});}
