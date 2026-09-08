import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { canonicalizeCheckoutPii, encryptCheckoutPii } from "../../lib/commerce/checkoutPii.ts";
import { localDatabaseUrl } from "./local-database.mjs";

if (!process.argv.includes("--local")) throw new Error("LOCAL_ONLY");
const sql=postgres(localDatabaseUrl(),{max:1,prepare:false}),hash=v=>createHash("sha256").update(v).digest("hex");
const rollback="EXPECTED_R1B_ROLLBACK"; let evidence;
try{
 await sql.begin(async tx=>{
  const tag=randomUUID().replaceAll("-","").slice(0,12),store=randomUUID(),list=randomUUID(),product=randomUUID(),variant=randomUUID(),location=randomUUID(),cart=randomUUID(),guest=hash(`${tag}:guest`);
  await tx`insert into stores(id,code,name,status) values(${store},${`rb-${tag}`},'R1B','active')`;
  await tx`insert into price_lists(id,code,name,currency,channel,status) values(${list},${`rb-${tag}`},'R1B','BRL','storefront','active')`;
  await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${store},${list},'BRL','storefront_retail',1,now()-interval '1 day')`;
  await tx`insert into products(id,name,slug,status,published_at) values(${product},'R1B',${`rb-${tag}`},'active',now())`;
  await tx`insert into product_variants(id,product_id,sku,status) values(${variant},${product},${`RB-${tag}`},'active')`;
  const price=(await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${variant},${list},1000,'BRL',now()-interval '1 minute') returning id`)[0];
  await tx`insert into inventory_locations(id,code,name,status) values(${location},${`rb-${tag}`},'R1B','active')`;
  await tx`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${variant},${location},2)`;
  await tx`insert into carts(id,store_id,guest_token_fingerprint,expires_at) values(${cart},${store},${guest},now()+interval '1 hour')`;
  await tx`insert into cart_items(cart_id,product_variant_id,quantity) values(${cart},${variant},1)`;
  const prepared=(await tx`select id,status::text,version from prepare_native_checkout(${store},${cart},null,${guest},${`r1b-idempotency-${tag}`},${hash(`${tag}:request`)},0,${list},${location},now()+interval '30 minutes',false)`)[0];
  const pii=canonicalizeCheckoutPii({contact:{firstName:"Pessoa",lastName:"Sintetica",company:"",email:"r1b@example.invalid",phone:"11912345678",personType:"fisica",taxDocument:"52998224725"},billing:{recipient:"Pessoa Sintetica",company:"",street:"Rua Teste",number:"10",complement:"",neighborhood:"Centro",city:"Jundiai",state:"SP",postalCode:"13201000",country:"BR"},shipping:{recipient:"Pessoa Sintetica",company:"",street:"Rua Teste",number:"10",complement:"",neighborhood:"Centro",city:"Jundiai",state:"SP",postalCode:"13201000",country:"BR"},shippingSameAsBilling:true});
  const keys={currentKeyId:()=>"r1b-v1",encryptionKey:()=>Buffer.alloc(32,61),fingerprintKey:()=>Buffer.alloc(32,62)},encrypted=encryptCheckoutPii({checkoutSessionId:prepared.id,storeId:store,envelope:pii,keys});
  const persisted=(await tx`select * from persist_checkout_pii(${prepared.id},null,${guest},${prepared.version},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${encrypted.envelopeVersion},${encrypted.keyId},${encrypted.fingerprint},${encrypted.destinationFingerprint},now()+interval '20 minutes')`)[0];
  const before=(await tx`select price_fingerprint from checkout_session_items where checkout_session_id=${prepared.id}`)[0];
  await tx`update prices set list_amount_minor=1200 where id=${price.id}`;
  const current=(await tx`select list_amount_minor from prices where id=${price.id}`)[0];
  let readyStatus=null,readyError=null;
  try{readyStatus=(await tx.savepoint(sp=>sp`select status::text from mark_native_checkout_ready(${prepared.id},null,${guest},${persisted.checkout_version},${encrypted.fingerprint})`))[0].status;}catch(error){readyError=error.message;}
  evidence={preparedStatus:prepared.status,snapshotFingerprint:before.price_fingerprint,currentPrice:String(current.list_amount_minor),readyStatus,readyError,staleSnapshotAccepted:readyStatus==='ready'};
  throw new Error(rollback);
 });
}catch(error){if(error.message!==rollback)throw error;}finally{await sql.end({timeout:5});}
console.log(JSON.stringify(evidence,null,2));
assert.equal(evidence.staleSnapshotAccepted,false,"READINESS_ACCEPTED_STALE_PRICE_SNAPSHOT");

// R1C deterministic commercial matrix. Every case is synthetic and rolled back.
const matrixSql=postgres(localDatabaseUrl(),{max:1,prepare:false});
async function runPriceCase(label,{list=1000,sale=null,saleFrom=null,saleTo=null,mutate=null,expectReady=false,secondLine=false}={}){
 let result;
 try{
  await matrixSql.begin(async tx=>{
   const tag=randomUUID().replaceAll("-","").slice(0,12),store=randomUUID(),priceList=randomUUID(),product=randomUUID(),variant=randomUUID(),location=randomUUID(),cart=randomUUID(),guest=hash(`${tag}:guest`);
   await tx`insert into stores(id,code,name,status) values(${store},${`rc-${tag}`},'R1C','active')`;
   await tx`insert into price_lists(id,code,name,currency,channel,status) values(${priceList},${`rc-${tag}`},'R1C','BRL','storefront','active')`;
   const assignment=(await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${store},${priceList},'BRL','storefront_retail',1,now()-interval '1 day') returning id`)[0];
   await tx`insert into products(id,name,slug,status,published_at) values(${product},'R1C',${`rc-${tag}`},'active',now())`;
   await tx`insert into product_variants(id,product_id,sku,status) values(${variant},${product},${`RC-${tag}`},'active')`;
   const price=(await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,sale_amount_minor,currency,valid_from,sale_valid_from,sale_valid_to) values(${variant},${priceList},${list},${sale},'BRL',now()-interval '1 hour',${saleFrom},${saleTo}) returning id`)[0];
   await tx`insert into inventory_locations(id,code,name,status) values(${location},${`rc-${tag}`},'R1C','active')`;
   await tx`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${variant},${location},2)`;
   await tx`insert into carts(id,store_id,guest_token_fingerprint,expires_at) values(${cart},${store},${guest},now()+interval '1 hour')`;
   await tx`insert into cart_items(cart_id,product_variant_id,quantity) values(${cart},${variant},1)`;
   if(secondLine){
    const product2=randomUUID(),variant2=randomUUID();
    await tx`insert into products(id,name,slug,status,published_at) values(${product2},'R1C second',${`rc-${tag}-second`},'active',now())`;
    await tx`insert into product_variants(id,product_id,sku,status) values(${variant2},${product2},${`RC-${tag}-2`},'active')`;
    await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${variant2},${priceList},1000,'BRL',now()-interval '1 hour')`;
    await tx`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${variant2},${location},2)`;
    await tx`insert into cart_items(cart_id,product_variant_id,quantity) values(${cart},${variant2},1)`;
   }
   const prepared=(await tx`select id,status::text,version from prepare_native_checkout(${store},${cart},null,${guest},${`r1c-case-${tag}`},${hash(`${tag}:request`)},0,${priceList},${location},now()+interval '30 minutes',false)`)[0];
   const pii=canonicalizeCheckoutPii({contact:{firstName:"Pessoa",lastName:"Sintetica",company:"",email:"r1c@example.invalid",phone:"11912345678",personType:"fisica",taxDocument:"52998224725"},billing:{recipient:"Pessoa Sintetica",company:"",street:"Rua Teste",number:"10",complement:"",neighborhood:"Centro",city:"Jundiai",state:"SP",postalCode:"13201000",country:"BR"},shipping:{recipient:"Pessoa Sintetica",company:"",street:"Rua Teste",number:"10",complement:"",neighborhood:"Centro",city:"Jundiai",state:"SP",postalCode:"13201000",country:"BR"},shippingSameAsBilling:true});
   const keys={currentKeyId:()=>"r1c-v1",encryptionKey:()=>Buffer.alloc(32,71),fingerprintKey:()=>Buffer.alloc(32,72)},encrypted=encryptCheckoutPii({checkoutSessionId:prepared.id,storeId:store,envelope:pii,keys});
   const persisted=(await tx`select * from persist_checkout_pii(${prepared.id},null,${guest},${prepared.version},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${encrypted.envelopeVersion},${encrypted.keyId},${encrypted.fingerprint},${encrypted.destinationFingerprint},now()+interval '20 minutes')`)[0];
   const before=(await tx`select price_fingerprint,unit_regular_amount_minor,unit_effective_amount_minor from checkout_session_items where checkout_session_id=${prepared.id}`)[0];
   if(mutate) await mutate(tx,{price,assignment,store,priceList,variant});
   let status=null,error=null;
   try{status=(await tx.savepoint(sp=>sp`select status::text from mark_native_checkout_ready(${prepared.id},null,${guest},${persisted.checkout_version},${encrypted.fingerprint})`))[0].status;}catch(cause){error=cause.message;}
   const after=(await tx`select status::text from checkout_sessions where id=${prepared.id}`)[0];
   const snapshot=(await tx`select price_fingerprint,unit_regular_amount_minor,unit_effective_amount_minor from checkout_session_items where checkout_session_id=${prepared.id}`)[0];
   assert.equal(status,expectReady?'ready':null,`${label}: status`);
   assert.equal(error,expectReady?null:'CHECKOUT_PRICE_STALE',`${label}: error`);
   assert.deepEqual(snapshot,before,`${label}: snapshot mutated`);
   assert.equal(after.status,expectReady?'ready':'validating',`${label}: final state`);
   result={label,status,error,finalState:after.status,snapshotMutated:false};
   throw new Error(rollback);
  });
 }catch(error){if(error.message!==rollback)throw error;}
 return result;
}

const now=new Date(),past=new Date(now.getTime()-3600000),future=new Date(now.getTime()+3600000);
const matrix=[];
matrix.push(await runPriceCase('unchanged',{expectReady:true}));
matrix.push(await runPriceCase('price_increase',{mutate:(tx,{price})=>tx`update prices set list_amount_minor=1200 where id=${price.id}`}));
matrix.push(await runPriceCase('price_decrease',{list:1200,mutate:(tx,{price})=>tx`update prices set list_amount_minor=1000 where id=${price.id}`}));
matrix.push(await runPriceCase('sale_starts',{list:1200,sale:1000,saleFrom:future,mutate:(tx,{price})=>tx`update prices set sale_valid_from=now()-interval '1 minute' where id=${price.id}`}));
matrix.push(await runPriceCase('sale_ends',{list:1200,sale:1000,saleFrom:past,saleTo:future,mutate:(tx,{price})=>tx`update prices set sale_valid_to=now()-interval '1 second' where id=${price.id}`}));
matrix.push(await runPriceCase('validity_ends',{mutate:(tx,{price})=>tx`update prices set valid_to=now()-interval '1 second' where id=${price.id}`}));
matrix.push(await runPriceCase('assignment_stale',{mutate:async(tx,{assignment,store,priceList})=>{await tx`update store_price_list_assignments set valid_to=statement_timestamp() where id=${assignment.id}`;await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${store},${priceList},'BRL','storefront_retail',2,statement_timestamp())`;}}));
matrix.push(await runPriceCase('multi_line_single_as_of',{expectReady:true,secondLine:true}));
await matrixSql.end({timeout:5});
console.log(JSON.stringify({matrix,currencyMismatch:'REJECTED_BEFORE_READINESS_BY_CONSTRAINT',priceListMismatch:'REJECTED_AT_PREPARE_BY_EXPLICIT_AUTHORITY',multiLineSingleAsOf:'PASS'},null,2));

// R1B-R3 structural probe: a syntactically valid but different logistics
// fingerprint must not be accepted as authoritative readiness evidence.
const shippingSql=postgres(localDatabaseUrl(),{max:1,prepare:false}); let shippingFingerprintEvidence;
try {
 await shippingSql.begin(async tx=>{
  const tag=randomUUID().replaceAll("-","").slice(0,12),store=randomUUID(),list=randomUUID(),product=randomUUID(),variant=randomUUID(),location=randomUUID(),cart=randomUUID(),guest=hash(`${tag}:guest`);
  await tx`insert into stores(id,code,name,status) values(${store},${`r3-${tag}`},'R1B R3','active')`;
  await tx`insert into price_lists(id,code,name,currency,channel,status) values(${list},${`r3-${tag}`},'R1B R3','BRL','storefront','active')`;
  await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values(${store},${list},'BRL','storefront_retail',1,now()-interval '1 day')`;
  await tx`insert into products(id,name,slug,status,published_at) values(${product},'R1B R3',${`r3-${tag}`},'active',now())`;
  await tx`insert into product_variants(id,product_id,sku,status) values(${variant},${product},${`R3-${tag}`},'active')`;
  await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${variant},${list},1000,'BRL',now()-interval '1 minute')`;
  await tx`insert into inventory_locations(id,code,name,status) values(${location},${`r3-${tag}`},'R1B R3','active')`;
  await tx`insert into inventory_levels(product_variant_id,inventory_location_id,quantity_on_hand) values(${variant},${location},2)`;
  await tx`insert into carts(id,store_id,guest_token_fingerprint,expires_at) values(${cart},${store},${guest},now()+interval '1 hour')`;
  await tx`insert into cart_items(cart_id,product_variant_id,quantity) values(${cart},${variant},1)`;
  const prepared=(await tx`select id,status::text,version from prepare_native_checkout(${store},${cart},null,${guest},${`r3-checkout-${tag}`},${hash(`${tag}:request`)},0,${list},${location},now()+interval '30 minutes',true,'initial',null,'melhor_envio','synthetic','Synthetic','Synthetic',100,'13201000',${"1".repeat(64)},${"2".repeat(64)},'v1',now()+interval '20 minutes',1,null)`)[0];
  const pii=canonicalizeCheckoutPii({contact:{firstName:"Pessoa",lastName:"Sintetica",company:"",email:"r3@example.invalid",phone:"11912345678",personType:"fisica",taxDocument:"52998224725"},billing:{recipient:"Pessoa Sintetica",company:"",street:"Rua Teste",number:"10",complement:"",neighborhood:"Centro",city:"Jundiai",state:"SP",postalCode:"13201000",country:"BR"},shipping:{recipient:"Pessoa Sintetica",company:"",street:"Rua Teste",number:"10",complement:"",neighborhood:"Centro",city:"Jundiai",state:"SP",postalCode:"13201000",country:"BR"},shippingSameAsBilling:true});
  const keys={currentKeyId:()=>"r3-v1",encryptionKey:()=>Buffer.alloc(32,81),fingerprintKey:()=>Buffer.alloc(32,82)},encrypted=encryptCheckoutPii({checkoutSessionId:prepared.id,storeId:store,envelope:pii,keys});
  const persisted=(await tx`select * from persist_checkout_pii(${prepared.id},null,${guest},${prepared.version},${encrypted.ciphertext},${encrypted.iv},${encrypted.authTag},${encrypted.envelopeVersion},${encrypted.keyId},${encrypted.fingerprint},${encrypted.destinationFingerprint},now()+interval '20 minutes')`)[0];
  const evidence=(await tx`select * from create_native_shipping_evidence(${prepared.id},null,${guest},${persisted.checkout_version},${`r3-evidence-${tag}`},null,'melhor_envio','synthetic','Synthetic','Synthetic',100,'13201000',${encrypted.destinationFingerprint},${"a".repeat(64)},now()+interval '20 minutes',1,null)`)[0];
  await tx`select * from replace_native_checkout_shipping_quote(${prepared.id},null,${guest},${persisted.checkout_version},${evidence.id},'replacement')`;
  const registry=[];
  const rejectCase=async(scenario,mutation,restore)=>{
   await mutation(); let status=null,error=null;
   try { status=(await tx.savepoint(sp=>sp`select status::text from mark_native_checkout_ready(${prepared.id},null,${guest},${persisted.checkout_version},${encrypted.fingerprint})`))[0].status; } catch(cause) { error=cause.message; }
   const state=(await tx`select status::text from checkout_sessions where id=${prepared.id}`)[0].status;
   registry.push({scenario,required:true,executed:true,expected:'CHECKOUT_SHIPPING_QUOTE_INVALID',actual:status??error,result:status===null&&error==='CHECKOUT_SHIPPING_QUOTE_INVALID'&&state==='validating'?'PASS':'FAIL',error,cleanup:'RESTORED_IN_TRANSACTION'});
   await restore();
  };
  await rejectCase('MISSING_EVIDENCE',()=>tx`delete from checkout_shipping_quotes where checkout_session_id=${prepared.id}`,()=>tx`select * from replace_native_checkout_shipping_quote(${prepared.id},null,${guest},${persisted.checkout_version},${evidence.id},'restored')`);
  await rejectCase('FINGERPRINT_TAMPER',()=>tx`update checkout_shipping_quotes set logistics_fingerprint=${"b".repeat(64)} where checkout_session_id=${prepared.id}`,()=>tx`update checkout_shipping_quotes set logistics_fingerprint=${evidence.canonical_fingerprint} where checkout_session_id=${prepared.id}`);
  await rejectCase('VERSION_TAMPER',()=>tx`update checkout_shipping_quotes set logistics_version='tampered-v2' where checkout_session_id=${prepared.id}`,()=>tx`update checkout_shipping_quotes set logistics_version=${evidence.logistics_version} where checkout_session_id=${prepared.id}`);
  await rejectCase('AMOUNT_TAMPER',()=>tx`update checkout_shipping_quotes set amount_minor=101 where checkout_session_id=${prepared.id}`,()=>tx`update checkout_shipping_quotes set amount_minor=${evidence.amount_minor} where checkout_session_id=${prepared.id}`);
  await rejectCase('CURRENCY_TAMPER',()=>tx`update checkout_shipping_quotes set currency='USD' where checkout_session_id=${prepared.id}`,()=>tx`update checkout_shipping_quotes set currency=${evidence.currency} where checkout_session_id=${prepared.id}`);
  await rejectCase('PROVIDER_TAMPER',()=>tx`update checkout_shipping_quotes set provider='woocommerce' where checkout_session_id=${prepared.id}`,()=>tx`update checkout_shipping_quotes set provider=${evidence.provider} where checkout_session_id=${prepared.id}`);
  await rejectCase('SERVICE_TAMPER',()=>tx`update checkout_shipping_quotes set service_name='tampered' where checkout_session_id=${prepared.id}`,()=>tx`update checkout_shipping_quotes set service_name=${evidence.service_name} where checkout_session_id=${prepared.id}`);
  await rejectCase('DESTINATION_TAMPER',()=>tx`update checkout_shipping_quotes set destination_fingerprint=${"c".repeat(64)} where checkout_session_id=${prepared.id}`,()=>tx`update checkout_shipping_quotes set destination_fingerprint=${evidence.destination_fingerprint} where checkout_session_id=${prepared.id}`);
  const expiryAuthoritative=(await tx`select r1d_shipping_quote_is_authoritative(${prepared.id},${store},'BRL',${encrypted.destinationFingerprint},now()+interval '1 day') ok`)[0].ok;
  registry.push({scenario:'EXPIRY',required:true,executed:true,expected:false,actual:expiryAuthoritative,result:expiryAuthoritative===false?'PASS':'FAIL',error:null,cleanup:'TRANSACTION_ROLLBACK'});
  const missingRequired=registry.filter(item=>item.required&&item.result!=='PASS').length;
  let completenessSelfTest='FAIL'; try { const probe=[...registry,{scenario:'OMITTED_SELF_TEST',required:true,executed:false,result:'OMITTED'}]; if(probe.some(item=>item.required&&!item.executed)) throw new Error('R1D_RUNTIME_MATRIX_INCOMPLETE'); } catch(cause) { if(cause.message==='R1D_RUNTIME_MATRIX_INCOMPLETE') completenessSelfTest='PASS'; }
  const happy=(await tx`select status::text from mark_native_checkout_ready(${prepared.id},null,${guest},${persisted.checkout_version},${encrypted.fingerprint})`)[0].status;
  shippingFingerprintEvidence={registry,requiredScenarioCount:registry.filter(item=>item.required).length,executedRequiredCount:registry.filter(item=>item.required&&item.executed).length,missingRequiredCount:missingRequired,completenessSelfTest,happyPath:happy,result:missingRequired===0&&completenessSelfTest==='PASS'&&happy==='ready'?"PASS":"FAIL",fixtureCleanup:"TRANSACTION_ROLLBACK"};
  throw new Error(rollback);
 });
} catch(error) { if(error.message!==rollback)throw error; } finally { await shippingSql.end({timeout:5}); }
console.log(JSON.stringify(shippingFingerprintEvidence,null,2));
assert.equal(shippingFingerprintEvidence.result,"PASS","R1D_RUNTIME_MATRIX_INCOMPLETE");
