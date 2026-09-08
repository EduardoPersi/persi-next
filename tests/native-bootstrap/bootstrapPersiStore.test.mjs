import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import postgres from "postgres";
import { PERSI_BOOTSTRAP, runPersiBootstrap } from "../../scripts/database/bootstrap-persi-store.mjs";
import { localDatabaseUrl } from "../../scripts/database/local-database.mjs";

const sql = postgres(localDatabaseUrl(), { max: 8, prepare: false });
const rollback = Symbol("rollback");
const config = (suffix = randomUUID()) => ({ ...PERSI_BOOTSTRAP, storeCode: `test-${suffix}`, storeName: `Synthetic store ${suffix}`, priceListCode: `list-${suffix}`, priceListId: randomUUID() });

async function fixture(tx, value, overrides = {}) {
  const productId = randomUUID(), variantId = randomUUID();
  await tx`insert into price_lists(id,code,name,currency,channel,status) values
    (${value.priceListId},${overrides.code ?? value.priceListCode},'Synthetic list',${overrides.currency ?? value.currency},${overrides.channel ?? "storefront"},${overrides.status ?? "active"})`;
  await tx`insert into products(id,name,slug,status,published_at) values(${productId},'Synthetic product',${`synthetic-${productId}`},'active',now())`;
  await tx`insert into product_variants(id,product_id,sku,status) values(${variantId},${productId},${`S-${variantId}`},'active')`;
  if (!overrides.missing) await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,sale_amount_minor,currency,status) values
    (${variantId},${value.priceListId},1000,900,${overrides.priceCurrency ?? value.currency},'active')`;
  return { productId, variantId };
}

async function inRollback(callback) {
  try { await sql.begin(async (tx) => { await deactivateCatalog(tx); await callback(tx); throw rollback; }); }
  catch (error) { if (error !== rollback) throw error; }
}

async function deactivateCatalog(tx) {
  await tx`update products set status='inactive',published_at=null where status='active'`;
  await tx`update product_variants set status='inactive' where status='active'`;
}

test("dry-run is read-only and reports two intended mutations", async () => inRollback(async (tx) => {
  const value = config("dry-run"); await fixture(tx, value);
  const dry = await runPersiBootstrap(tx, { config: value, useExistingTransaction: true });
  assert.equal(dry.status, "READY_TO_APPLY"); assert.equal(dry.writes, 0);
  assert.deepEqual(dry.expectedMutations, { stores: 1, assignments: 1 });
  assert.equal((await tx`select count(*)::int count from stores`)[0].count, 0);
}));

test("first apply and exact rerun are safe", async () => inRollback(async (tx) => {
  const value = config("happy"); await fixture(tx, value);
  const first = await runPersiBootstrap(tx, { config: value, apply: true, useExistingTransaction: true });
  assert.equal(first.status, "BOOTSTRAPPED"); assert.equal(first.writes, 2);
  assert.deepEqual(first.finalCounts, { stores: 1, assignments: 1 });
  assert.equal(first.resolver.price_list_id, value.priceListId); assert.equal(BigInt(first.resolver.assignment_version), 1n);
  const second = await runPersiBootstrap(tx, { config: value, apply: true, useExistingTransaction: true });
  assert.equal(second.status, "ALREADY_BOOTSTRAPPED"); assert.equal(second.writes, 0);
  assert.equal((await tx`select count(*)::int count from store_price_list_assignments where store_id=${first.store.id}::uuid`)[0].count, 1);
}));

test("conflicting store fails without repair", async () => inRollback(async (tx) => {
  const value = config("conflict"); await fixture(tx, value);
  await tx`insert into stores(code,name,status,default_currency,timezone) values(${value.storeCode},'Different name','active','BRL','America/Sao_Paulo')`;
  await assert.rejects(runPersiBootstrap(tx, { config: value, apply: true, useExistingTransaction: true }), /BOOTSTRAP_CONFLICT/);
  assert.equal((await tx`select count(*)::int count from store_price_list_assignments`)[0].count, 0);
}));

for (const [label, override, expected] of [
  ["wrong code", { code: "wrong-list" }, /PRICE_LIST_CODE_MISMATCH/],
  ["currency mismatch", { currency: "USD", priceCurrency: "USD" }, /PRICE_LIST_CURRENCY_MISMATCH/],
  ["wrong channel", { channel: "admin" }, /PRICE_LIST_CHANNEL_MISMATCH/],
  ["inactive list", { status: "inactive" }, /PRICE_LIST_INACTIVE/],
]) test(label, async () => inRollback(async (tx) => {
  const value = config(label.replaceAll(" ", "-")); await fixture(tx, value, override);
  await assert.rejects(runPersiBootstrap(tx, { config: value, apply: true, useExistingTransaction: true }), expected);
  assert.equal((await tx`select count(*)::int count from stores`)[0].count, 0);
}));

test("wrong UUID fails double identity", async () => inRollback(async (tx) => {
  const value = config("wrong-uuid"), actual = { ...value, priceListId: randomUUID() };
  await fixture(tx, actual, { code: value.priceListCode });
  await assert.rejects(runPersiBootstrap(tx, { config: value, apply: true, useExistingTransaction: true }), /PRICE_LIST_UUID_MISMATCH/);
  assert.equal((await tx`select count(*)::int count from stores`)[0].count, 0);
}));

test("missing coverage fails before store insert", async () => inRollback(async (tx) => {
  const value = config("missing"); await fixture(tx, value, { missing: true });
  await assert.rejects(runPersiBootstrap(tx, { config: value, apply: true, useExistingTransaction: true }), /PRICE_COVERAGE_INCOMPLETE/);
  assert.equal((await tx`select count(*)::int count from stores`)[0].count, 0);
}));

test("ambiguous coverage fails before store insert", async () => inRollback(async (tx) => {
  const value = config("ambiguous"), ids = await fixture(tx, value);
  await tx`alter table prices disable trigger prices_prevent_overlap`;
  await tx`insert into prices(product_variant_id,price_list_id,list_amount_minor,currency,status) values(${ids.variantId},${value.priceListId},1100,'BRL','active')`;
  await assert.rejects(runPersiBootstrap(tx, { config: value, apply: true, useExistingTransaction: true }), /PRICE_COVERAGE_INCOMPLETE/);
  assert.equal((await tx`select count(*)::int count from stores`)[0].count, 0);
}));

test("failure after store insert rolls transaction back", async () => {
  await sql.begin((tx) => deactivateCatalog(tx));
  const value = config("rollback"); await sql.begin((tx) => fixture(tx, value));
  await assert.rejects(runPersiBootstrap(sql, { config: value, apply: true, injectFailureAfterStore: true }), /INJECTED_AFTER_STORE/);
  assert.equal((await sql`select count(*)::int count from stores where code=${value.storeCode}`)[0].count, 0);
  assert.equal((await sql`select count(*)::int count from store_price_list_assignments a join stores s on s.id=a.store_id where s.code=${value.storeCode}`)[0].count, 0);
  await sql.begin((tx) => deactivateCatalog(tx));
});

test("20 concurrent cycles serialize to one logical bootstrap", async () => {
  let duplicates = 0, partial = 0;
  for (let cycle = 0; cycle < 20; cycle += 1) {
    await sql.begin((tx) => deactivateCatalog(tx));
    const value = config(`c${cycle}-${randomUUID().slice(0, 8)}`); await sql.begin((tx) => fixture(tx, value));
    const results = await Promise.all([
      runPersiBootstrap(sql, { config: value, apply: true }),
      runPersiBootstrap(sql, { config: value, apply: true }),
    ]);
    assert.deepEqual(results.map((item) => item.status).sort(), ["ALREADY_BOOTSTRAPPED", "BOOTSTRAPPED"]);
    const [counts] = await sql`select
      (select count(*)::int from stores where code=${value.storeCode}) stores,
      (select count(*)::int from store_price_list_assignments a join stores s on s.id=a.store_id where s.code=${value.storeCode}) assignments,
      (select count(*)::int from store_price_list_assignments a join stores s on s.id=a.store_id where s.code=${value.storeCode} and a.version=1) version_one,
      (select count(*)::int from store_price_list_assignments a join stores s on s.id=a.store_id where s.code=${value.storeCode} and a.version<>1) other_versions`;
    if (counts.stores !== 1 || counts.assignments !== 1 || counts.version_one !== 1 || counts.other_versions !== 0) { duplicates += Math.max(0, counts.stores - 1) + Math.max(0, counts.assignments - 1); partial += Number(counts.stores !== counts.assignments); }
    assert.deepEqual(counts, { stores: 1, assignments: 1, version_one: 1, other_versions: 0 });
    await sql.begin((tx) => deactivateCatalog(tx));
  }
  assert.equal(duplicates, 0); assert.equal(partial, 0);
});

test("runtime configuration files remain unchanged and Woo-default", () => {
  const example = fs.readFileSync(".env.example", "utf8");
  const flags = fs.readFileSync("lib/catalog/flags.ts", "utf8");
  assert.match(example, /^CATALOG_DATA_SOURCE=woocommerce$/m);
  assert.match(flags, /environment\.CATALOG_DATA_SOURCE==="postgres"\?"postgres":"woocommerce"/);
  assert.doesNotMatch(fs.readFileSync("scripts/database/bootstrap-persi-store.mjs", "utf8"), /process\.env\.[A-Z_]+\s*=/);
});

test.after(async () => { await sql.end({ timeout: 5 }); });
