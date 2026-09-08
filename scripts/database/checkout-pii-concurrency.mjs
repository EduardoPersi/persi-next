import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { assertFixtureBaseline, captureFixtureBaseline, cleanupFixtureRun } from "./fixture-isolation.mjs";
import { localDatabaseUrl } from "./local-database.mjs";

if (!process.argv.includes("--local")) throw new Error("LOCAL_ONLY");
const sql=postgres(localDatabaseUrl(),{max:20,prepare:false});
const cycles=50,runId=randomUUID().replaceAll("-","").slice(0,12); let failures=0,conflicts=0,staleQuotes=0;
const hash=(value)=>createHash("sha256").update(value).digest("hex");
const baseline=await captureFixtureBaseline(sql);
try {
  for(let cycle=0;cycle<cycles;cycle+=1){
    const tag=`${runId}-${cycle}`,store=randomUUID(),cart=randomUUID(),checkout=randomUUID(),method=randomUUID(),guest=hash(`${tag}:guest`);
    await sql.begin(async tx=>{
      await tx`insert into stores(id,code,name,status) values(${store},${`p3a-${tag}`},'P3A concurrency','active')`;
      await tx`insert into carts(id,store_id,guest_token_fingerprint,expires_at) values(${cart},${store},${guest},now()+interval '1 hour')`;
      await tx`insert into checkout_sessions(id,store_id,cart_id,currency,idempotency_key,request_hash,cart_version,expires_at) values(${checkout},${store},${cart},'BRL',${`p3a-${tag}`},${hash(`${tag}:request`)},0,now()+interval '30 minutes')`;
      await tx`insert into shipping_methods(id,provider,external_code,carrier_name,service_name,status) values(${method},'melhor_envio',${`svc-${tag}`},'Synthetic','Synthetic','active')`;
      await tx`insert into checkout_shipping_quotes(checkout_session_id,quote_key,shipping_method_id,provider,external_service_code,carrier_name,service_name,amount_minor,currency,destination_postcode,destination_fingerprint,logistics_fingerprint,logistics_version,is_selected,quoted_at,expires_at,selected_at) values(${checkout},'old',${method},'melhor_envio',${`svc-${tag}`},'Synthetic','Synthetic',100,'BRL','13201000',${hash(`${tag}:old-destination`)},${hash(`${tag}:logistics`)},'v1',true,now(),now()+interval '10 minutes',now())`;
    });
    const write=(marker)=>sql`select checkout_version from persist_checkout_pii(${checkout},null,${guest},0,${marker.repeat(32)},${marker.repeat(16)},${marker.repeat(22)},1,${`test-${marker}`},${hash(`${tag}:${marker}:pii`)},${hash(`${tag}:${marker}:destination`)},now()+interval '20 minutes')`;
    try {
      const results=await Promise.allSettled([write("A"),write("B")]);
      assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
      assert.equal(results.filter(result=>result.status==="rejected").length,1); conflicts+=1;
      const [row]=await sql`select version,pii_ciphertext,pii_iv,pii_auth_tag,pii_key_id from checkout_sessions where id=${checkout}`;
      assert.equal(String(row.version),"1");
      const marker=row.pii_ciphertext[0]; assert.equal(row.pii_iv,marker.repeat(16)); assert.equal(row.pii_auth_tag,marker.repeat(22)); assert.equal(row.pii_key_id,`test-${marker}`);
      const [quote]=await sql`select count(*)::int count from checkout_shipping_quotes where checkout_session_id=${checkout}`;
      if(quote.count!==0) staleQuotes+=1; assert.equal(quote.count,0);
    } catch(error){ failures+=1; throw error; }
  }
} finally {
  await sql`delete from shipping_methods where external_code like ${`svc-${runId}-%`} and carrier_name='Synthetic' and service_name='Synthetic'`;
  await cleanupFixtureRun(sql,{storeCodePrefixes:[`p3a-${runId}-`]});
  assertFixtureBaseline(baseline,await captureFixtureBaseline(sql));
  console.log("FIXTURE_CLEANUP_PASS");
  await sql.end({timeout:5});
  console.log(JSON.stringify({cycles,requests:cycles*2,successfulWrites:cycles,conflicts,staleQuotes,failures}));
}
