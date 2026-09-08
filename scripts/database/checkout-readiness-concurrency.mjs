import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { canonicalizeCheckoutPii, encryptCheckoutPii } from "../../lib/commerce/checkoutPii.ts";
import { assertFixtureBaseline, captureFixtureBaseline, cleanupFixtureRun } from "./fixture-isolation.mjs";
import { localDatabaseUrl } from "./local-database.mjs";

if (!process.argv.includes("--local")) throw new Error("LOCAL_ONLY");
const url=localDatabaseUrl(),setup=postgres(url,{max:1,prepare:false}),first=postgres(url,{max:1,prepare:false}),second=postgres(url,{max:1,prepare:false});
const runId=randomUUID().replaceAll("-","").slice(0,12),cycles=50,hash=v=>createHash("sha256").update(v).digest("hex");
const baseline=await captureFixtureBaseline(setup); let readyWins=0,piiWins=0,staleReady=0,duplicates=0,deadlocks=0,overselling=0;
const keys={currentKeyId:()=>"c3-race-v1",encryptionKey:()=>Buffer.alloc(32,41),fingerprintKey:()=>Buffer.alloc(32,42)};
const pii=(cycle,number)=>canonicalizeCheckoutPii({contact:{firstName:"Pessoa",lastName:`Sintetica ${number}`,company:"",email:`race-${cycle}-${number}@example.invalid`,phone:"11912345678",personType:"fisica",taxDocument:"52998224725"},billing:{recipient:"Pessoa Sintetica",company:"",street:"Rua Teste",number:String(number),complement:"",neighborhood:"Centro",city:"Jundiai",state:"SP",postalCode:"13201000",country:"BR"},shipping:{recipient:"Pessoa Sintetica",company:"",street:"Rua Teste",number:String(number),complement:"",neighborhood:"Centro",city:"Jundiai",state:"SP",postalCode:"13201000",country:"BR"},shippingSameAsBilling:true});

try {
 for(let cycle=0;cycle<cycles;cycle+=1){
  const tag=`${runId}-${cycle}`,store=randomUUID(),list=randomUUID(),product=randomUUID(),variant=randomUUID(),location=randomUUID(),cart=randomUUID(),guest=hash(`${tag}:guest`);
  await setup.begin(async tx=>{
   await tx`insert into stores(id,code,name,status) values(${store},${`cr-${tag}`},'C3 race','active')`;
   await tx`insert into price_lists(id,code,name,currency,channel,status) values(${list},${`cr-${tag}`},'C3 race','BRL','storefront','active')`;
   await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${store},${list},'BRL','storefront_retail',1,now()-interval '1 day')`;
   await tx`insert into products(id,name,slug,status,published_at) values(${product},'C3 race',${`cr-${tag}`},'active',now())`;
   await tx`insert into product_variants(id,product_id,sku,status) values(${variant},${product},${`CR-${tag}`},'active')`;
   await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${variant},${list},1000,'BRL',now()-interval '1 minute')`;
   await tx`insert into inventory_locations(id,code,name,status) values(${location},${`cr-${tag}`},'C3 race','active')`;
   await tx`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${variant},${location},1)`;
   await tx`insert into carts(id,store_id,guest_token_fingerprint,expires_at) values(${cart},${store},${guest},now()+interval '1 hour')`;
   await tx`insert into cart_items(cart_id,product_variant_id,quantity) values(${cart},${variant},1)`;
  });
  const prepared=(await setup`select id,status::text,version from prepare_native_checkout(${store},${cart},null,${guest},${`race-idempotency-${tag}`},${hash(`${tag}:request`)},0,${list},${location},now()+interval '30 minutes',false)`)[0];
  assert.equal(prepared.status,"validating");
  const initial=encryptCheckoutPii({checkoutSessionId:prepared.id,storeId:store,envelope:pii(cycle,10),keys});
  const persisted=(await setup`select * from persist_checkout_pii(${prepared.id},null,${guest},${prepared.version},${initial.ciphertext},${initial.iv},${initial.authTag},${initial.envelopeVersion},${initial.keyId},${initial.fingerprint},${initial.destinationFingerprint},now()+interval '20 minutes')`)[0];
  const changed=encryptCheckoutPii({checkoutSessionId:prepared.id,storeId:store,envelope:pii(cycle,11),keys});
  const race=await Promise.allSettled([
   first`select * from persist_checkout_pii(${prepared.id},null,${guest},${persisted.checkout_version},${changed.ciphertext},${changed.iv},${changed.authTag},${changed.envelopeVersion},${changed.keyId},${changed.fingerprint},${changed.destinationFingerprint},now()+interval '20 minutes')`,
   second`select * from mark_native_checkout_ready(${prepared.id},null,${guest},${persisted.checkout_version},${initial.fingerprint})`
  ]);
  const won=race.filter(x=>x.status==='fulfilled'); assert.equal(won.length,1);
  const row=(await setup`select status::text,pii_fingerprint from checkout_sessions where id=${prepared.id}`)[0];
  if(row.status==='ready'){readyWins+=1;if(row.pii_fingerprint!==initial.fingerprint)staleReady+=1;} else {piiWins+=1;assert.equal(row.status,'validating');assert.equal(row.pii_fingerprint,changed.fingerprint);}
  const counts=(await setup`select count(distinct s.id)::int sessions,count(distinct r.id)::int reservations,max(l.quantity_reserved-l.quantity_on_hand)::int overage from checkout_sessions s join checkout_session_items i on i.checkout_session_id=s.id join inventory_reservations r on r.checkout_session_item_id=i.id join inventory_levels l on l.id=r.inventory_level_id where s.cart_id=${cart}`)[0];
  duplicates+=Math.max(0,counts.sessions-1)+Math.max(0,counts.reservations-1); if(counts.overage>0)overselling+=1;
  for(const outcome of race)if(outcome.status==='rejected'&&outcome.reason?.code==='40P01')deadlocks+=1;
 }
} finally {
 await cleanupFixtureRun(setup,{storeCodePrefixes:[`cr-${runId}-`],productSlugPrefixes:[`cr-${runId}-`],locationCodePrefixes:[`cr-${runId}-`],priceListCodePrefixes:[`cr-${runId}-`]});
 assertFixtureBaseline(baseline,await captureFixtureBaseline(setup)); console.log('FIXTURE_CLEANUP_PASS');
 await Promise.all([setup.end({timeout:5}),first.end({timeout:5}),second.end({timeout:5})]);
}
console.log(JSON.stringify({cycles,readyWins,piiWins,staleReady,duplicates,deadlocks,overselling}));
assert.equal(staleReady,0);assert.equal(duplicates,0);assert.equal(deadlocks,0);assert.equal(overselling,0);
