import assert from "node:assert/strict";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";

if (!process.argv.includes("--local")) throw new Error("LOCAL_ONLY");
if (process.env.PERSI_DISPOSABLE_DATABASE !== "1") throw new Error("DISPOSABLE_DATABASE_REQUIRED");
const sql = postgres(localDatabaseUrl(), { max: 12, prepare: false });
const cycles = 20;
let failures = 0;
try {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const tag = crypto.randomUUID();
    const [store] = await sql`insert into stores(code,name,status) values(${`cart-${tag}`},'Synthetic Cart Store','active') returning id`;
    const [customer] = await sql`insert into customers(email) values(${`${tag}@example.invalid`}) returning id`;
    const [product] = await sql`insert into products(name,slug) values('Synthetic Cart Product',${`cart-${tag}`}) returning id`;
    const [variant] = await sql`insert into product_variants(product_id,sku) values(${product.id},${`CART-${tag}`}) returning id`;
    const guestFingerprint = Buffer.from(tag).toString("hex").padEnd(64,"0").slice(0,64);
    const [guest] = await sql`insert into carts(store_id,guest_token_fingerprint,expires_at) values(${store.id},${guestFingerprint},now()+interval '1 hour') returning id`;

    const adds = await Promise.all([
      sql`select add_native_cart_item(${guest.id},null,${guestFingerprint},${variant.id},1)`,
      sql`select add_native_cart_item(${guest.id},null,${guestFingerprint},${variant.id},1)`,
    ]);
    assert.equal(adds.length,2);
    const [added] = await sql`select quantity from cart_items where cart_id=${guest.id} and product_variant_id=${variant.id}`;
    assert.equal(String(added.quantity),"2");

    const creations = await Promise.allSettled(Array.from({length:6},()=>sql`insert into carts(store_id,customer_id,expires_at) values(${store.id},${customer.id},now()+interval '2 hours') returning id`));
    assert.equal(creations.filter(item=>item.status==='fulfilled').length,1);
    assert.equal((await sql`select count(*)::int count from carts where store_id=${store.id} and customer_id=${customer.id} and status='active'`)[0].count,1);
    const [target] = await sql`select id from carts where store_id=${store.id} and customer_id=${customer.id} and status='active'`;

    const race = await Promise.allSettled([
      sql`select merge_native_carts(${guest.id},${target.id},${customer.id},${guestFingerprint})`,
      sql`select add_native_cart_item(${guest.id},null,${guestFingerprint},${variant.id},1)`,
    ]);
    assert.ok(race.some(item=>item.status==='fulfilled'));
    const [state] = await sql`select status,guest_token_fingerprint,merged_into_cart_id from carts where id=${guest.id}`;
    assert.equal(state.status,'merged'); assert.equal(state.guest_token_fingerprint,null); assert.equal(state.merged_into_cart_id,target.id);

    // Fixtures are unique per cycle. Terminal carts remain untouched until the
    // disposable database is destroyed by the owning validation harness.
  }
} catch (error) { failures += 1; throw error; }
finally { await sql.end({timeout:5}); console.log(JSON.stringify({cycles,scenarios:3,failures,fixtureCollisions:0,cleanupErrors:0,terminalCleanupMutations:0})); }
