import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";
import { assertFixtureBaseline, captureFixtureBaseline, cleanupFixtureRun, injectFixtureFailureIfRequested } from "./fixture-isolation.mjs";

if (!process.argv.includes("--local")) throw new Error("LOCAL_ONLY");
const sql=postgres(localDatabaseUrl(),{max:24,prepare:false});
const cycles=20; let failures=0,executions=0,duplicateNumbers=0,duplicateCheckoutOrders=0,lostUpdates=0;
const runId=crypto.randomUUID().replaceAll("-", "").slice(0, 12),baseline=await captureFixtureBaseline(sql);
try {
  for(let cycle=0;cycle<cycles;cycle+=1){
    const tag=`${runId}-${cycle}`,storeA=crypto.randomUUID(),storeB=crypto.randomUUID();
    try {
      await sql`insert into stores(id,code,name,status) values(${storeA},${`oa-${tag}`},'Order A','active'),(${storeB},${`ob-${tag}`},'Order B','active')`;
      const sameStore=await Promise.all(Array.from({length:10},()=>sql`select * from allocate_native_order_number(${storeA}::uuid)`)); executions+=10;
      const numbers=sameStore.map(rows=>String(rows[0].order_sequence)); duplicateNumbers+=numbers.length-new Set(numbers).size;
      assert.equal(new Set(numbers).size,10);
      const multi=await Promise.all([sql`select * from allocate_native_order_number(${storeA}::uuid)`,sql`select * from allocate_native_order_number(${storeB}::uuid)`,sql`select * from allocate_native_order_number(${storeA}::uuid)`,sql`select * from allocate_native_order_number(${storeB}::uuid)`]); executions+=4;
      assert.deepEqual(multi.filter((_,i)=>i%2===1).map(x=>String(x[0].order_sequence)).sort(),["1","2"]);

      const cartId=crypto.randomUUID(),checkoutId=crypto.randomUUID();
      const guestFingerprint=createHash("sha256").update(tag).digest("hex");
      await sql`insert into carts(id,store_id,guest_token_fingerprint,expires_at) values(${cartId},${storeA},${guestFingerprint},now()+interval '1 hour')`;
      await sql`insert into checkout_sessions(id,store_id,cart_id,status,currency,idempotency_key,request_hash,cart_version,shipping_required,expires_at) values(${checkoutId},${storeA},${cartId},'open','BRL',${`order-checkout-${tag}`},${"b".repeat(64)},0,false,now()+interval '30 minutes')`;
      if(cycle===0)injectFixtureFailureIfRequested();
      const insertOrder=(sequence,suffix)=>sql.begin(async tx=>{
        const rows=await tx`insert into orders(store_id,checkout_session_id,order_sequence,order_number,currency,items_subtotal_minor,grand_total_minor,contact_name,contact_email) values(${storeA},${checkoutId},${sequence},${`OA-${tag}-${suffix}`},'BRL',0,0,'Synthetic',${`${suffix}@example.invalid`}) returning id`;
        await tx`insert into order_status_events(order_id,from_status,to_status,actor_type,correlation_id) values(${rows[0].id},null,'pending','system',${crypto.randomUUID()})`;
        return rows;
      });
      const checkoutRace=await Promise.allSettled([insertOrder(1000,"a"),insertOrder(1001,"b")]); executions+=2;
      const checkoutSuccess=checkoutRace.filter(x=>x.status==='fulfilled'); duplicateCheckoutOrders+=Math.max(0,checkoutSuccess.length-1); assert.equal(checkoutSuccess.length,1);
      const orderId=checkoutSuccess[0].value[0].id;
      const transitionRace=await Promise.allSettled([
        sql`select transition_native_order(${orderId},'pending','confirmed',0,'worker',null,null,null,${crypto.randomUUID()})`,
        sql`select transition_native_order(${orderId},'pending','cancelled',0,'worker',null,null,null,${crypto.randomUUID()})`
      ]); executions+=2;
      const transitionSuccess=transitionRace.filter(x=>x.status==='fulfilled').length; if(transitionSuccess!==1) lostUpdates+=1; assert.equal(transitionSuccess,1);
    } catch(error) {
      failures+=1;
      console.error(`cycle=${cycle}`,error.code,error.message);
      if (error.message === "INJECTED_FIXTURE_FAILURE") throw error;
    }
  }
} finally {
  await cleanupFixtureRun(sql,{storeCodePrefixes:[`oa-${runId}-`,`ob-${runId}-`]});
  assertFixtureBaseline(baseline,await captureFixtureBaseline(sql));
  console.log("FIXTURE_CLEANUP_PASS");
  await sql.end({timeout:5});
}
console.log(JSON.stringify({cycles,scenarios:4,scenarioExecutions:executions,duplicateNumbers,duplicateCheckoutOrders,lostUpdates,failures}));
assert.equal(failures,0); assert.equal(duplicateNumbers,0); assert.equal(duplicateCheckoutOrders,0); assert.equal(lostUpdates,0);
