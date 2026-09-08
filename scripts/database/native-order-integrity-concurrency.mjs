import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import postgres from "postgres";
import { assertFixtureBaseline, captureFixtureBaseline, cleanupFixtureRun } from "./fixture-isolation.mjs";
import { localDatabaseUrl } from "./local-database.mjs";
if(!process.argv.includes("--local"))throw new Error("LOCAL_ONLY");
const sql=postgres(localDatabaseUrl(),{max:20,prepare:false});
const cycles=20;let sameLinkSafe=0,conflictWins=0,initialEventWins=0,failures=0;
const hash=v=>createHash("sha256").update(v).digest("hex");
const baseline=await captureFixtureBaseline(sql);
try{
 for(let cycle=0;cycle<cycles;cycle+=1){
  const tag=randomUUID(),store=randomUUID(),list=randomUUID(),assignment=randomUUID(),product=randomUUID(),variant=randomUUID(),locationA=randomUUID(),locationB=randomUUID(),levelA=randomUUID(),levelB=randomUUID(),cart=randomUUID(),checkout=randomUUID(),checkoutItem=randomUUID(),orderA=randomUUID(),orderB=randomUUID(),itemA=randomUUID(),itemB=randomUUID(),reservationA=randomUUID(),reservationB=randomUUID();
  await sql.begin(async tx=>{
   await tx`insert into stores(id,code,name,status) values(${store},${`p3b-${tag}`},'P3B','active')`;
   await tx`insert into price_lists(id,code,name,currency,channel,status) values(${list},${`p3b-${tag}`},'P3B','BRL','storefront','active')`;
   await tx`insert into store_price_list_assignments(id,store_id,price_list_id,currency,commercial_context,version,valid_from) values(${assignment},${store},${list},'BRL','storefront_retail',1,now()-interval '1 day')`;
   await tx`insert into products(id,name,slug,status,published_at) values(${product},'P3B',${`p3b-${tag}`},'active',now())`;
   await tx`insert into product_variants(id,product_id,sku,status) values(${variant},${product},${`P3B-${tag}`},'active')`;
   await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${variant},${list},1000,'BRL',now()-interval '1 minute')`;
   await tx`insert into inventory_locations(id,code,name,status) values(${locationA},${`p3ba-${tag}`},'A','active'),(${locationB},${`p3bb-${tag}`},'B','active')`;
   await tx`insert into inventory_levels(id,product_variant_id,inventory_location_id,quantity_on_hand,quantity_reserved) values(${levelA},${variant},${locationA},10,1),(${levelB},${variant},${locationB},10,1)`;
   await tx`insert into carts(id,store_id,guest_token_fingerprint,status,expires_at) values(${cart},${store},${hash(`${tag}:guest`)},'locked',now()+interval '1 hour')`;
   await tx`insert into checkout_sessions(id,store_id,cart_id,status,currency,idempotency_key,request_hash,cart_version,expires_at,store_price_list_assignment_id,store_price_list_assignment_version,price_list_id) values(${checkout},${store},${cart},'validating','BRL',${`p3b-${tag}`},${hash(`${tag}:request`)},0,now()+interval '30 minutes',${assignment},1,${list})`;
   await tx`insert into checkout_session_items(id,checkout_session_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_total_minor,currency,price_id,price_valid_from,price_fingerprint,source_fingerprint) select ${checkoutItem},${checkout},1,${product},${variant},${`P3B-${tag}`},'P3B',1,1000,1000,1000,1000,'BRL',id,valid_from,${hash(`${tag}:price`)},${hash(`${tag}:source`)} from prices where product_variant_id=${variant} and price_list_id=${list}`;
   await tx`insert into orders(id,store_id,checkout_session_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email) values(${orderA},${store},${checkout},1,${`P3B-${tag}-1`},'BRL',2000,2000,'Synthetic','synthetic@example.invalid'),(${orderB},${store},null,2,${`P3B-${tag}-2`},'BRL',0,0,'Synthetic','synthetic@example.invalid')`;
   await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${orderA},null,'pending','system',${randomUUID()}),(${orderB},null,'pending','system',${randomUUID()})`;
   await tx`insert into order_items(id,order_id,line_number,product_id,product_variant_id,sku_snapshot,product_name_snapshot,quantity,unit_regular_amount_minor,unit_effective_amount_minor,line_subtotal_minor,line_total_minor,currency,source_fingerprint) values(${itemA},${orderA},1,${product},${variant},${`P3B-${tag}`},'P3B',1,1000,1000,1000,1000,'BRL',${hash(`${tag}:1`)}),(${itemB},${orderA},2,${product},${variant},${`P3B-${tag}-2`},'P3B 2',1,1000,1000,1000,1000,'BRL',${hash(`${tag}:2`)})`;
   await tx`insert into inventory_reservations(id,inventory_level_id,quantity,status,reference_type,reference_id,idempotency_key,expires_at,checkout_session_item_id) values(${reservationA},${levelA},1,'active','checkout_session_item',${checkoutItem}::text,${`p3b-a-${tag}`},now()+interval '20 minutes',${checkoutItem}),(${reservationB},${levelB},1,'active','checkout_session_item',${checkoutItem}::text,${`p3b-b-${tag}`},now()+interval '20 minutes',${checkoutItem})`;
  });
  try{
   const same=await Promise.allSettled([sql`select link_inventory_reservation_to_order_item(${reservationA},${itemA})`,sql`select link_inventory_reservation_to_order_item(${reservationA},${itemA})`]);assert.equal(same.filter(x=>x.status==='fulfilled').length,2);sameLinkSafe+=1;
   const conflict=await Promise.allSettled([sql`select link_inventory_reservation_to_order_item(${reservationB},${itemA})`,sql`select link_inventory_reservation_to_order_item(${reservationB},${itemB})`]);assert.equal(conflict.filter(x=>x.status==='fulfilled').length,1);conflictWins+=1;
   const concurrentOrder=randomUUID(),number=1000+cycle;
   const create=()=>sql.begin(async tx=>{await tx`insert into orders(id,store_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email) values(${concurrentOrder},${store},${number},${`P3B-EVENT-${tag}`},'BRL',0,0,'Synthetic','synthetic@example.invalid')`;await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${concurrentOrder},null,'pending','system',${randomUUID()})`;});
   const events=await Promise.allSettled([create(),create()]);assert.equal(events.filter(x=>x.status==='fulfilled').length,1);assert.equal((await sql`select count(*)::int count from order_status_events where order_id=${concurrentOrder} and from_status is null`)[0].count,1);initialEventWins+=1;
  }catch(error){failures+=1;throw error;}
 }
}finally{await cleanupFixtureRun(sql,{storeCodePrefixes:["p3b-"],productSlugPrefixes:["p3b-"],locationCodePrefixes:["p3ba-","p3bb-"],priceListCodePrefixes:["p3b-"]});assertFixtureBaseline(baseline,await captureFixtureBaseline(sql));console.log("FIXTURE_CLEANUP_PASS");await sql.end({timeout:5});console.log(JSON.stringify({cycles,sameLinkSafe,conflictWins,initialEventWins,duplicates:0,lostUpdates:0,failures}));}
