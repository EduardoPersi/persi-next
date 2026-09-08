import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";

if (!process.argv.includes("--local")) throw new Error("LOCAL_ONLY");
const sql = postgres(localDatabaseUrl(), { max: 16, prepare: false });
const cycles = 20;
let executions = 0, overlapsAccepted = 0, duplicateVersions = 0, mixedSnapshots = 0, failures = 0;

const insertAssignment = (store, list, version, from, to = null) => sql`
  insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from,valid_to)
  values(${store},${list},'BRL','storefront_retail',${version},${from},${to}) returning id
`;

try {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const tag = randomUUID(), store = randomUUID(), listA = randomUUID(), listB = randomUUID();
    try {
      await sql`insert into stores(id,code,name,status) values(${store},${`pa-${tag}`},'Authority concurrency','active')`;
      await sql`insert into price_lists(id,code,name,currency,channel,status) values
        (${listA},${`pal-a-${tag}`},'List A','BRL','storefront','active'),
        (${listB},${`pal-b-${tag}`},'List B','BRL','storefront','active')`;

      const overlap = await Promise.allSettled([
        insertAssignment(store, listA, 1, "2026-01-01T00:00:00Z"),
        insertAssignment(store, listB, 2, "2026-06-01T00:00:00Z"),
      ]); executions += 2;
      const overlapSuccess = overlap.filter((item) => item.status === "fulfilled").length;
      overlapsAccepted += Math.max(0, overlapSuccess - 1); assert.equal(overlapSuccess, 1);

      await sql`delete from store_price_list_assignments where store_id=${store}`.catch(() => {});
      // History is intentionally undeletable, so use a fresh scope for each remaining scenario.
      const versionStore = randomUUID();
      await sql`insert into stores(id,code,name,status) values(${versionStore},${`pv-${tag}`},'Version concurrency','active')`;
      const versions = await Promise.allSettled([
        insertAssignment(versionStore, listA, 1, "2026-01-01T00:00:00Z"),
        insertAssignment(versionStore, listB, 1, "2027-01-01T00:00:00Z"),
      ]); executions += 2;
      const versionSuccess = versions.filter((item) => item.status === "fulfilled").length;
      duplicateVersions += Math.max(0, versionSuccess - 1); assert.equal(versionSuccess, 1);

      const changeStore = randomUUID(), oldId = randomUUID();
      await sql`insert into stores(id,code,name,status) values(${changeStore},${`pc-${tag}`},'Change concurrency','active')`;
      await sql`insert into store_price_list_assignments(id,store_id,price_list_id,currency,commercial_context,version,valid_from)
        values(${oldId},${changeStore},${listA},'BRL','storefront_retail',1,'2026-01-01')`;
      const asOf = new Date().toISOString();
      const change = () => sql.begin(async (tx) => {
        await tx`update store_price_list_assignments set valid_to=${asOf} where id=${oldId}`;
        await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values
          (${changeStore},${listB},'BRL','storefront_retail',2,${asOf})`;
      });
      const resolutionRace = await Promise.all([
        sql`select assignment_version,price_list_id from resolve_store_price_authority(${changeStore},'BRL','storefront_retail',${asOf})`,
        change(),
      ]); executions += 2;
      const resolved = resolutionRace[0][0];
      assert.ok((String(resolved.assignment_version) === "1" && resolved.price_list_id === listA) ||
        (String(resolved.assignment_version) === "2" && resolved.price_list_id === listB));

      const checkoutStore = randomUUID(), checkoutOld = randomUUID(), cart = randomUUID(), checkout = randomUUID();
      await sql`insert into stores(id,code,name,status) values(${checkoutStore},${`ps-${tag}`},'Snapshot concurrency','active')`;
      await sql`insert into store_price_list_assignments(id,store_id,price_list_id,currency,commercial_context,version,valid_from)
        values(${checkoutOld},${checkoutStore},${listA},'BRL','storefront_retail',1,'2026-01-01')`;
      await sql`insert into carts(id,store_id,guest_token_fingerprint,expires_at,status) values(${cart},${checkoutStore},${tag.replaceAll("-","").padEnd(64,"0")},now()+interval '1 hour','locked')`;
      await sql`insert into checkout_sessions(id,store_id,cart_id,status,currency,idempotency_key,request_hash,cart_version,expires_at)
        values(${checkout},${checkoutStore},${cart},'validating','BRL',${`snapshot-${tag}`},${"a".repeat(64)},0,now()+interval '30 minutes')`;
      const switchAt = new Date(Date.now() + 5).toISOString();
      const checkoutRace = await Promise.allSettled([
        sql`update checkout_sessions set status='ready' where id=${checkout} returning store_price_list_assignment_version,price_list_id`,
        sql.begin(async (tx) => {
          await tx`update store_price_list_assignments set valid_to=${switchAt} where id=${checkoutOld}`;
          await tx`insert into store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from) values
            (${checkoutStore},${listB},'BRL','storefront_retail',2,${switchAt})`;
        }),
      ]); executions += 2;
      const snapshotResult = checkoutRace[0]; assert.equal(snapshotResult.status, "fulfilled");
      const snap = snapshotResult.value[0];
      if (!((String(snap.store_price_list_assignment_version) === "1" && snap.price_list_id === listA) ||
            (String(snap.store_price_list_assignment_version) === "2" && snap.price_list_id === listB))) mixedSnapshots += 1;
    } catch (error) { failures += 1; console.error(`cycle=${cycle}`, error.code, error.message); }
  }
} finally { await sql.end({ timeout: 5 }); }

console.log(JSON.stringify({ cycles, scenarios: 4, executions, overlapsAccepted, duplicateVersions, mixedSnapshots, failures }));
assert.equal(overlapsAccepted, 0); assert.equal(duplicateVersions, 0); assert.equal(mixedSnapshots, 0); assert.equal(failures, 0);
