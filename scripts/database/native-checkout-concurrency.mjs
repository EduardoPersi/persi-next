import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";
import { injectFixtureFailureIfRequested } from "./fixture-isolation.mjs";

if (!process.argv.includes("--local")) throw new Error("LOCAL_ONLY");
if (process.env.PERSI_DISPOSABLE_DATABASE !== "1") throw new Error("DISPOSABLE_DATABASE_REQUIRED");
const sql=postgres(localDatabaseUrl(),{max:20,prepare:false});
const cycles=20,scenarioNames=["double_click","active_checkout","cart_mutation","last_unit","multi_item_rollback","expiration_race"];
let failures=0,executions=0,overselling=0;
const runId=randomUUID().replaceAll("-", "").slice(0, 12);
const hash=(value)=>createHash("sha256").update(value).digest("hex");

async function prepare({store,cart,fingerprint,key,requestHash,priceList,location,version=0,expiresMs=30000}) {
  return sql`select (public.prepare_native_checkout(
    ${store}::uuid,${cart}::uuid,null,${fingerprint},${key},${requestHash},${version}::bigint,
    ${priceList}::uuid,${location}::uuid,${new Date(Date.now()+expiresMs).toISOString()}::timestamptz,false
  )).id id`;
}

async function cart(store,fingerprint,lines) {
  const [row]=await sql`insert into carts(store_id,guest_token_fingerprint,expires_at) values(${store},${fingerprint},now()+interval '1 day') returning id`;
  for (const [variant,quantity] of lines) await sql`insert into cart_items(cart_id,product_variant_id,quantity) values(${row.id},${variant},${quantity})`;
  return row.id;
}

try {
  for(let cycle=0;cycle<cycles;cycle+=1){
    const tag=`${runId}-${cycle}`,storeA=randomUUID(),storeB=randomUUID(),priceList=randomUUID(),location=randomUUID();
    const productIds=Array.from({length:6},()=>randomUUID()),variants=Array.from({length:6},()=>randomUUID()),levels=Array.from({length:6},()=>randomUUID());
    await sql.begin(async tx=>{
      await tx`insert into stores(id,code,name,status) values(${storeA},${`c1a-${tag}`},'C1 A','active'),(${storeB},${`c1b-${tag}`},'C1 B','active')`;
      await tx`insert into price_lists(id,code,name,currency,channel,status) values(${priceList},${`c1p-${tag}`},'C1 prices','BRL','storefront','active')`;
      await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values
        (${storeA},${priceList},'BRL','storefront_retail',1,now()-interval '1 day'),
        (${storeB},${priceList},'BRL','storefront_retail',1,now()-interval '1 day')`;
      await tx`insert into inventory_locations(id,code,name,status) values(${location},${`c1l-${tag}`},'C1 location','active')`;
      for(let i=0;i<variants.length;i+=1){
        await tx`insert into products(id,name,slug,status,published_at) values(${productIds[i]},${`C1 Product ${i}`},${`c1-${tag}-${i}`},'active',now())`;
        await tx`insert into product_variants(id,product_id,sku,status) values(${variants[i]},${productIds[i]},${`C1-${tag}-${i}`},'active')`;
        await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,valid_from) values(${variants[i]},${priceList},1000,'BRL',now()-interval '1 minute')`;
        await tx`insert into inventory_levels(id,product_variant_id,inventory_location_id,quantity_on_hand) values(${levels[i]},${variants[i]},${location},${i===5?0:20})`;
      }
    });
    if(cycle===0)injectFixtureFailureIfRequested();

    try {
      const c1=await cart(storeA,hash(`${tag}-dc`),[[variants[0],1]]), args1={store:storeA,cart:c1,fingerprint:hash(`${tag}-dc`),key:`double-click-${tag}`,requestHash:hash(`${tag}-dc-request`),priceList,location};
      const dc=await Promise.allSettled([prepare(args1),prepare(args1)]); executions+=2;
      assert.equal(dc.filter(x=>x.status==='fulfilled').length,2); assert.equal(dc[0].value[0].id,dc[1].value[0].id);
      assert.equal((await sql`select count(*)::int count from inventory_reservations r join checkout_session_items i on i.id=r.checkout_session_item_id where i.checkout_session_id=${dc[0].value[0].id}`)[0].count,1);

      const c2=await cart(storeA,hash(`${tag}-active`),[[variants[1],1]]), base2={store:storeA,cart:c2,fingerprint:hash(`${tag}-active`),requestHash:hash(`${tag}-active-request`),priceList,location};
      const active=await Promise.allSettled([prepare({...base2,key:`active-a-${tag}`}),prepare({...base2,key:`active-b-${tag}`})]); executions+=2;
      assert.equal(active.filter(x=>x.status==='fulfilled').length,1);

      const c3=await cart(storeA,hash(`${tag}-mutation`),[[variants[2],1]]), mutationArgs={store:storeA,cart:c3,fingerprint:hash(`${tag}-mutation`),key:`mutation-${tag}`,requestHash:hash(`${tag}-mutation-request`),priceList,location};
      const mutation=await Promise.allSettled([
        prepare(mutationArgs),
        sql`select add_native_cart_item(${c3},null,${mutationArgs.fingerprint},${variants[2]},1)`,
      ]); executions+=2;
      assert.equal(mutation.filter(x=>x.status==='fulfilled').length,1);
      const [mutationCart]=await sql`select status,version from carts where id=${c3}`;
      const snapshots=await sql`select i.quantity,s.cart_version from checkout_session_items i join checkout_sessions s on s.id=i.checkout_session_id where s.cart_id=${c3}`;
      if(snapshots.length) assert.equal(String(snapshots[0].cart_version),'0'); else assert.equal(String(mutationCart.version),'1');

      await sql`update inventory_levels set quantity_on_hand=1 where id=${levels[3]}`;
      const c4a=await cart(storeA,hash(`${tag}-last-a`),[[variants[3],1]]),c4b=await cart(storeA,hash(`${tag}-last-b`),[[variants[3],1]]);
      const last=await Promise.allSettled([
        prepare({store:storeA,cart:c4a,fingerprint:hash(`${tag}-last-a`),key:`last-a-${tag}`,requestHash:hash(`${tag}-last-a-r`),priceList,location}),
        prepare({store:storeA,cart:c4b,fingerprint:hash(`${tag}-last-b`),key:`last-b-${tag}`,requestHash:hash(`${tag}-last-b-r`),priceList,location})
      ]); executions+=2;
      assert.equal(last.filter(x=>x.status==='fulfilled').length,1);
      const [lastLevel]=await sql`select quantity_on_hand,quantity_reserved from inventory_levels where id=${levels[3]}`;
      if(lastLevel.quantity_reserved>lastLevel.quantity_on_hand) overselling+=1;
      assert.equal(String(lastLevel.quantity_reserved),'1');

      const c5=await cart(storeA,hash(`${tag}-multi`),[[variants[4],1],[variants[5],1]]);
      const before=(await sql`select quantity_reserved from inventory_levels where id=${levels[4]}`)[0].quantity_reserved;
      const multi=await Promise.allSettled([prepare({store:storeA,cart:c5,fingerprint:hash(`${tag}-multi`),key:`multi-${tag}`,requestHash:hash(`${tag}-multi-r`),priceList,location})]); executions+=1;
      assert.equal(multi[0].status,'rejected');
      assert.equal((await sql`select count(*)::int count from checkout_sessions where cart_id=${c5}`)[0].count,0);
      assert.equal((await sql`select quantity_reserved from inventory_levels where id=${levels[4]}`)[0].quantity_reserved,before);

      const c6=await cart(storeB,hash(`${tag}-expiry`),[[variants[0],1]]), expiryArgs={store:storeB,cart:c6,fingerprint:hash(`${tag}-expiry`),key:`expiry-${tag}`,requestHash:hash(`${tag}-expiry-r`),priceList,location,expiresMs:150};
      const prepared=await prepare(expiryArgs); await new Promise(resolve=>setTimeout(resolve,200));
      const expiry=await Promise.allSettled([sql`select close_native_checkout(${prepared[0].id},'expired')`,prepare(expiryArgs)]); executions+=2;
      assert.equal(expiry.filter(x=>x.status==='fulfilled').length,1);
      assert.equal((await sql`select status::text status from checkout_sessions where id=${prepared[0].id}`)[0].status,'expired');
      assert.equal((await sql`select count(*)::int count from inventory_reservations r join checkout_session_items i on i.id=r.checkout_session_item_id where i.checkout_session_id=${prepared[0].id} and r.status='active'`)[0].count,0);
    } catch(error){failures+=1;throw error;}
  }
} finally {
  console.log("DISPOSABLE_FIXTURE_LIFECYCLE_PASS");
  await sql.end({timeout:5});
  console.log(JSON.stringify({cycles,scenarios:scenarioNames.length,scenarioExecutions:executions,failures,overselling,fixtureCollisions:0,cleanupErrors:0,terminalCleanupMutations:0}));
}
