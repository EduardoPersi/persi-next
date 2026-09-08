import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import postgres from "postgres";
import {canonicalizeCheckoutPii,encryptCheckoutPii} from "../../lib/commerce/checkoutPii.ts";
import {captureFixtureBaseline,cleanupFixtureRun,assertFixtureBaseline} from "./fixture-isolation.mjs";
import {localDatabaseUrl} from "./local-database.mjs";

if(!process.argv.includes("--local"))throw new Error("LOCAL_ONLY");
const url=localDatabaseUrl(),admin=postgres(url,{max:1,prepare:false}),hash=v=>createHash("sha256").update(v).digest("hex");
const prefix=`r1c-race-${randomUUID().replaceAll("-","").slice(0,8)}`,baseline=await captureFixtureBaseline(admin);
let coherent=0,stale=0,invalid=0,deadlocks=0,timeouts=0,lostUpdates=0;
const pii=canonicalizeCheckoutPii({contact:{firstName:"Pessoa",lastName:"Sintetica",company:"",email:"race@example.invalid",phone:"11912345678",personType:"fisica",taxDocument:"52998224725"},billing:{recipient:"Pessoa Sintetica",company:"",street:"Rua Teste",number:"10",complement:"",neighborhood:"Centro",city:"Jundiai",state:"SP",postalCode:"13201000",country:"BR"},shipping:{recipient:"Pessoa Sintetica",company:"",street:"Rua Teste",number:"10",complement:"",neighborhood:"Centro",city:"Jundiai",state:"SP",postalCode:"13201000",country:"BR"},shippingSameAsBilling:true});
try{
 for(let cycle=0;cycle<50;cycle++){
  const tag=`${prefix}-${cycle}`,ids={store:randomUUID(),list:randomUUID(),product:randomUUID(),variant:randomUUID(),location:randomUUID(),cart:randomUUID()},guest=hash(`${tag}:guest`);
  const setup=await admin.begin(async tx=>{
   await tx`insert into stores(id,code,name,status) values(${ids.store},${tag},'R1C race','active')`;
   await tx`insert into price_lists(id,code,name,currency,channel,status) values(${ids.list},${tag},'R1C race','BRL','storefront','active')`;
   await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${ids.store},${ids.list},'BRL','storefront_retail',1,now()-interval '1 day')`;
   await tx`insert into products(id,name,slug,status,published_at) values(${ids.product},'R1C race',${tag},'active',now())`;
   await tx`insert into product_variants(id,product_id,sku,status) values(${ids.variant},${ids.product},${`R1C-${cycle}-${prefix}`},'active')`;
   const price=(await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${ids.variant},${ids.list},1000,'BRL',now()-interval '1 minute') returning id`)[0];
   await tx`insert into inventory_locations(id,code,name,status) values(${ids.location},${tag},'R1C race','active')`;
   await tx`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${ids.variant},${ids.location},2)`;
   await tx`insert into carts(id,store_id,guest_token_fingerprint,expires_at) values(${ids.cart},${ids.store},${guest},now()+interval '1 hour')`;
   await tx`insert into cart_items(cart_id,product_variant_id,quantity) values(${ids.cart},${ids.variant},1)`;
   const prepared=(await tx`select id,version from prepare_native_checkout(${ids.store},${ids.cart},null,${guest},${`race-key-${tag}`},${hash(`${tag}:request`)},0,${ids.list},${ids.location},now()+interval '30 minutes',false)`)[0];
   const keys={currentKeyId:()=>"race-v1",encryptionKey:()=>Buffer.alloc(32,81),fingerprintKey:()=>Buffer.alloc(32,82)},encrypted=encryptCheckoutPii({checkoutSessionId:prepared.id,storeId:ids.store,envelope:pii,keys});
   const persisted=(await tx`select * from persist_checkout_pii(${prepared.id},null,${guest},${prepared.version},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${encrypted.envelopeVersion},${encrypted.keyId},${encrypted.fingerprint},${encrypted.destinationFingerprint},now()+interval '20 minutes')`)[0];
   return {checkout:prepared.id,version:persisted.checkout_version,price:price.id,fingerprint:encrypted.fingerprint};
  });
  const readyDb=postgres(url,{max:1,prepare:false}),priceDb=postgres(url,{max:1,prepare:false});let readyResult;
  const readyPromise=readyDb`select status::text from mark_native_checkout_ready(${setup.checkout},null,${guest},${setup.version},${setup.fingerprint})`.then(r=>({status:r[0].status})).catch(e=>({error:e.message,code:e.code}));
  const pricePromise=priceDb`update prices set list_amount_minor=1200 where id=${setup.price}`;
  [readyResult]=await Promise.all([readyPromise,pricePromise]);await readyDb.end({timeout:5});await priceDb.end({timeout:5});
  // A successful readiness held FOR KEY SHARE before the UPDATE could become
  // authoritative; if UPDATE wins its row lock first, readiness sees 1200 and rejects.
  if(readyResult.status==='ready')coherent++;
  else if(readyResult.error==='CHECKOUT_PRICE_STALE')stale++;
  else if(readyResult.code==='40P01')deadlocks++;
  else if(readyResult.code==='55P03'||readyResult.code==='57014')timeouts++;
  else lostUpdates++;
 }
 assert.equal(invalid,0,"INVALID_STALE_READY");assert.equal(deadlocks,0,"PRICE_RACE_DEADLOCK");assert.equal(timeouts,0,"PRICE_RACE_TIMEOUT");assert.equal(lostUpdates,0,"PRICE_RACE_UNEXPECTED");
}finally{
 await cleanupFixtureRun(admin,{storeCodePrefixes:[prefix],productSlugPrefixes:[prefix],locationCodePrefixes:[prefix],priceListCodePrefixes:[prefix]});
 const after=await captureFixtureBaseline(admin);assertFixtureBaseline(baseline,after);await admin.end({timeout:5});
}
console.log(JSON.stringify({cycles:50,oldCoherentWins:coherent,staleRejections:stale,invalidStaleReady:invalid,deadlocks,timeouts,lostUpdates:lostUpdates,fixtureCleanup:true},null,2));
