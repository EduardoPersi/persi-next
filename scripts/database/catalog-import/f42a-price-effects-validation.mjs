import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl } from "./config.mjs";
import { WooReadOnlyExtractor } from "./extract.mjs";

if(!process.argv.includes("--staging")||!process.argv.includes("--read-only"))throw new Error("Exige --staging --read-only.");
const id=14806,windowStart="2026-08-26T22:55:45.023Z",env=readPrivateEnvironment(),woo=new WooReadOnlyExtractor(env),sql=postgres(stagingDirectUrl(env.stagingPassword),{ssl:"require",prepare:false,max:1});
try{const product=(await woo.get(`products/${id}`)).data,[row]=await sql`select m.source_changed_at::text,
  (select count(*)::int from inventory_movements im join inventory_levels il on il.id=im.inventory_level_id join product_variants pv on pv.id=il.product_variant_id where pv.product_id=p.id and im.created_at>=${windowStart}) movements,
  (select count(*)::int from price_history ph join prices prh on prh.id=ph.price_id join product_variants pvh on pvh.id=prh.product_variant_id where pvh.product_id=p.id and ph.changed_at>=${windowStart} and ph.previous_list_amount_minor=7100 and ph.new_list_amount_minor=8835) expected_history,
  (select count(*)::int from price_history ph join prices prh on prh.id=ph.price_id join product_variants pvh on pvh.id=prh.product_variant_id where pvh.product_id=p.id and ph.changed_at>=${windowStart} and not(ph.previous_list_amount_minor=7100 and ph.new_list_amount_minor=8835)) unexpected_history
  from products p join external_mappings m on m.internal_id=p.id and m.system='woocommerce' and m.entity_type='product' where m.external_id=${String(id)}`;const sourceChangedAtValid=new Date(row.source_changed_at).toISOString()===new Date(`${product.date_modified_gmt}Z`).toISOString();console.log(JSON.stringify({wooExternalId:id,sourceChangedAtValid,artificialInventoryMovements:row.movements,expectedPriceHistory:row.expected_history,unexpectedPriceHistory:row.unexpected_history},null,2));if(!sourceChangedAtValid||row.movements!==0||row.expected_history!==1||row.unexpected_history!==0)process.exitCode=1;}finally{await sql.end({timeout:5});}
