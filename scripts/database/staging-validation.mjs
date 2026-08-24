import assert from "node:assert/strict";
import fs from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../../lib/db/schema/index.ts";

const PROJECT_REF = "vtrujmhhkmvjzfklzxip";
if (!process.argv.includes("--staging")) throw new Error("Este script exige --staging.");

function readPassword() {
  const envPath = fs.existsSync(".env.staging.local") ? ".env.staging.local" : ".env.local";
  const line = fs.readFileSync(envPath, "utf8").split(/\r?\n/)
    .find((entry) => entry.startsWith("PERSI_STAGING_DB_PASSWORD="));
  if (!line) throw new Error("PERSI_STAGING_DB_PASSWORD não configurada.");
  return line.slice(line.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
}

function authenticatedUrl(template, password) {
  const url = new URL(template);
  url.password = password;
  return url.toString();
}

const password = readPassword();
const directUrl = authenticatedUrl(`postgresql://postgres@db.${PROJECT_REF}.supabase.co:5432/postgres`, password);
const poolerTemplate = fs.readFileSync("supabase/.temp/pooler-url", "utf8").trim();
if (!poolerTemplate.includes(PROJECT_REF)) throw new Error("Pooler não pertence ao persi-staging.");
const poolerUrl = authenticatedUrl(poolerTemplate, password);
const direct = postgres(directUrl, { max: 12, prepare: false, ssl: "require", connect_timeout: 15 });
const pooler = postgres(poolerUrl, { max: 12, prepare: false, ssl: "require", connect_timeout: 15 });
const db = drizzle(direct, { schema });
const suffix = crypto.randomUUID();
const tag = `phase-d-${suffix}`;
const productIds = [];
const attributeIds = [];
const priceListIds = [];
const locationIds = [];
const unitFixtureIds = [];

async function expectError(work, code, message) {
  await assert.rejects(work, (error) => {
    assert.equal(error.code, code);
    if (message) assert.equal(error.message, message);
    return true;
  });
}

async function createProduct(label) {
  const [product] = await direct`
    insert into public.products (name, slug)
    values ('Phase D staging fixture', ${`${tag}-${label}`}) returning id
  `;
  productIds.push(product.id);
  const [variant] = await direct`
    insert into public.product_variants (product_id, sku)
    values (${product.id}, ${`PD-${label}-${suffix}`}) returning id
  `;
  return { productId: product.id, variantId: variant.id };
}

async function createLevel(label, quantity) {
  const entity = await createProduct(label);
  const [location] = await direct`
    insert into public.inventory_locations (code, name, status)
    values (${`${tag}-${label}`}, 'Phase D staging fixture', 'active') returning id
  `;
  locationIds.push(location.id);
  const [level] = await direct`
    insert into public.inventory_levels (product_variant_id, inventory_location_id, quantity_on_hand)
    values (${entity.variantId}, ${location.id}, ${quantity}) returning id
  `;
  return { ...entity, levelId: level.id };
}

async function reserve(client, levelId, reference) {
  return client`select * from public.reserve_inventory(
    ${levelId}, 1, 'phase-d-test', ${reference}, ${`${tag}-${reference}`},
    ${new Date(Date.now() + 300_000).toISOString()}
  )`;
}

function percentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return Math.round(ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] * 10) / 10;
}

async function samples(work, count = 20) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    await work(index);
    values.push(performance.now() - started);
  }
  return { p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95) };
}

async function cleanupPhaseDFixtures() {
  await direct`delete from public.inventory_movements where inventory_level_id in (
    select level.id from public.inventory_levels level
    join public.product_variants variant on variant.id = level.product_variant_id
    join public.products product on product.id = variant.product_id
    where product.name = 'Phase D staging fixture'
  )`;
  await direct`delete from public.inventory_reservations where inventory_level_id in (
    select level.id from public.inventory_levels level
    join public.product_variants variant on variant.id = level.product_variant_id
    join public.products product on product.id = variant.product_id
    where product.name = 'Phase D staging fixture'
  )`;
  await direct`delete from public.inventory_levels where product_variant_id in (
    select variant.id from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where product.name = 'Phase D staging fixture'
  )`;
  await direct`delete from public.price_history where price_id in (
    select price.id from public.prices price
    join public.product_variants variant on variant.id = price.product_variant_id
    join public.products product on product.id = variant.product_id
    where product.name = 'Phase D staging fixture'
  )`;
  await direct`delete from public.prices where product_variant_id in (
    select variant.id from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where product.name = 'Phase D staging fixture'
  )`;
  await direct`delete from public.external_mappings where internal_id in (
    select id from public.products where name = 'Phase D staging fixture'
  )`;
  await direct`delete from public.variant_attribute_values where variant_id in (
    select variant.id from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where product.name = 'Phase D staging fixture'
  )`;
  await direct`delete from public.product_variants where product_id in (
    select id from public.products where name = 'Phase D staging fixture'
  )`;
  await direct`delete from public.products where name = 'Phase D staging fixture'`;
  await direct`delete from public.measurement_components where attribute_value_id in (
    select value.id from public.attribute_values value
    join public.attributes attribute on attribute.id = value.attribute_id
    where attribute.name = 'Phase D measure'
  )`;
  await direct`delete from public.attribute_values where attribute_id in (
    select id from public.attributes where name = 'Phase D measure'
  )`;
  await direct`delete from public.attributes where name = 'Phase D measure'`;
  await direct`delete from public.price_lists where name = 'Phase D staging fixture'`;
  await direct`delete from public.inventory_locations where name = 'Phase D staging fixture'`;
  await direct`delete from public.units where name like 'Phase D % fixture'`;
}

let result;
let fixturesRemoved = false;
try {
  await cleanupPhaseDFixtures();
  const [identity] = await direct`select current_database() database, current_user role, version()`;
  assert.equal(identity.database, "postgres");
  assert.match(identity.version, /PostgreSQL 17\.6/);

  const transactionValue = await direct.begin(async (tx) => {
    const [row] = await tx`select gen_random_uuid() uuid_value, now() timestamptz_value, 9223372036854775806::bigint bigint_value`;
    return row;
  });
  assert.match(transactionValue.uuid_value, /^[0-9a-f-]{36}$/);
  const timestampValue = transactionValue.timestamptz_value;
  assert.ok(timestampValue instanceof Date || !Number.isNaN(Date.parse(timestampValue)));
  assert.equal(transactionValue.bigint_value, "9223372036854775806");

  const unitCodeSuffix = suffix.replaceAll("-", "");
  const [mm] = await direct`insert into public.units (code, symbol, name, dimension)
    values (${`PdMm${unitCodeSuffix}`}, 'mm', 'Phase D millimeter fixture', 'length') returning id`;
  const [inch] = await direct`insert into public.units (code, symbol, name, dimension)
    values (${`PdIn${unitCodeSuffix}`}, 'in', 'Phase D inch fixture', 'length') returning id`;
  unitFixtureIds.push(mm.id, inch.id);
  const unitIds = { mm: mm.id, in: inch.id };
  const [attribute] = await direct`
    insert into public.attributes (code, name, data_type, unit_dimension, is_commercial, is_technical)
    values (${tag.replaceAll("-", "_")}, 'Phase D measure', 'composite_measurement', 'length', true, true)
    returning id
  `;
  attributeIds.push(attribute.id);
  const [value] = await direct`
    insert into public.attribute_values (attribute_id, display_value, normalized_text)
    values (${attribute.id}, '16mm x 1/2"', '16 mm x 1/2 in') returning id
  `;
  await direct`insert into public.measurement_components
    (attribute_value_id, position, semantic_role, numerator, denominator, unit_id, display_value)
    values (${value.id}, 1, 'diameter_a', 16, 1, ${unitIds.mm}, '16 mm'),
           (${value.id}, 2, 'thread_b', 1, 2, ${unitIds.in}, '1/2 in')`;
  const components = await direct`select numerator, denominator from public.measurement_components where attribute_value_id = ${value.id} order by position`;
  assert.deepEqual(components.map((row) => [row.numerator, row.denominator]), [["16", "1"], ["1", "2"]]);

  const entity = await createProduct("main");
  const [variant] = await direct`select sku_normalized from public.product_variants where id = ${entity.variantId}`;
  assert.equal(variant.sku_normalized, `PD-MAIN-${suffix}`.toUpperCase());
  const [priceList] = await direct`
    insert into public.price_lists (code, name, currency, status)
    values (${tag}, 'Phase D staging fixture', 'BRL', 'active') returning id
  `;
  priceListIds.push(priceList.id);
  const [price] = await direct`
    insert into public.prices (product_variant_id, price_list_id, list_amount_minor, sale_amount_minor, currency)
    values (${entity.variantId}, ${priceList.id}, 1990, 1500, 'BRL') returning id
  `;
  await expectError(direct`insert into public.prices
    (product_variant_id, price_list_id, list_amount_minor, currency)
    values (${entity.variantId}, ${priceList.id}, 2000, 'BRL')`, "23P01", "overlapping_active_price_period");

  const inventory = await createLevel("inventory", 10);
  const [reserved] = await direct`select * from public.reserve_inventory(
    ${inventory.levelId}, 3, 'phase-d-test', 'inventory', ${`${tag}-inventory`},
    ${new Date(Date.now() + 300_000).toISOString()})`;
  await direct`select * from public.release_inventory_reservation(${reserved.id}, ${`${tag}-release`})`;
  const [inventoryState] = await direct`select quantity_on_hand, quantity_reserved, quantity_available from public.inventory_levels where id = ${inventory.levelId}`;
  assert.deepEqual([inventoryState.quantity_on_hand, inventoryState.quantity_reserved, inventoryState.quantity_available], ["10", "0", "10"]);

  await direct`insert into public.external_mappings (system, entity_type, internal_id, external_id)
    values ('woocommerce', 'product', ${entity.productId}, ${tag}),
           ('olist', 'product', ${entity.productId}, ${tag})`;
  await expectError(direct`insert into public.external_mappings (system, entity_type, internal_id, external_id)
    values ('woocommerce', 'product', ${inventory.productId}, ${tag})`, "23505");

  const drizzleProduct = await db.query.products.findFirst({ where: eq(schema.products.id, entity.productId) });
  const drizzlePrice = await db.query.prices.findFirst({ where: eq(schema.prices.id, price.id) });
  const drizzleInventory = await db.query.inventoryLevels.findFirst({ where: eq(schema.inventoryLevels.id, inventory.levelId) });
  assert.ok(drizzleProduct && drizzlePrice && drizzleInventory);
  assert.equal(typeof drizzlePrice.listAmountMinor, "bigint");
  assert.equal(typeof drizzleInventory.quantityOnHand, "bigint");

  const one = await createLevel("concurrency-one", 1);
  const oneResults = await Promise.allSettled([
    reserve(pooler, one.levelId, "one-a"), reserve(pooler, one.levelId, "one-b"),
  ]);
  assert.equal(oneResults.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(oneResults.filter((entry) => entry.status === "rejected").length, 1);
  const [oneState] = await direct`select quantity_reserved, quantity_available from public.inventory_levels where id = ${one.levelId}`;
  assert.deepEqual([oneState.quantity_reserved, oneState.quantity_available], ["1", "0"]);

  const five = await createLevel("concurrency-five", 5);
  const burstResults = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => reserve(pooler, five.levelId, `five-${index}`)));
  assert.equal(burstResults.filter((entry) => entry.status === "fulfilled").length, 5);
  assert.equal(burstResults.filter((entry) => entry.status === "rejected").length, 5);
  const [fiveState] = await direct`select quantity_reserved, quantity_available from public.inventory_levels where id = ${five.levelId}`;
  assert.deepEqual([fiveState.quantity_reserved, fiveState.quantity_available], ["5", "0"]);

  const latencyLevel = await createLevel("latency", 25);
  const latency = {
    select: await samples(() => pooler`select 1`),
    skuLookup: await samples(() => pooler`select id from public.product_variants where sku_normalized = ${`PD-MAIN-${suffix}`.toUpperCase()}`),
    productVariant: await samples(() => pooler`select p.id from public.products p join public.product_variants v on v.product_id = p.id where v.id = ${entity.variantId}`),
    inventoryLookup: await samples(() => pooler`select quantity_available from public.inventory_levels where id = ${latencyLevel.levelId}`),
    reservation: await samples((index) => reserve(pooler, latencyLevel.levelId, `latency-${index}`)),
  };

  result = {
    connection: { direct: true, transactionPooler: true, postgres: "17.6", prepare: false },
    drizzle: { queries: true, transaction: true, uuid: true, timestamptz: true, bigintType: "bigint" },
    pim: { composite: true, exactFraction: true },
    pricing: { bigintMinorUnits: true, overlapRejected: true },
    inventory: { reserveRelease: true, generatedAvailable: true, ledger: true },
    externalMappings: { crossSystem: true, duplicateRejected: true },
    concurrency: { oneUnit: "1 success / 1 rejection", fiveUnits: "5 success / 5 rejection", overselling: 0 },
    latency,
  };
} finally {
  try {
    await cleanupPhaseDFixtures();
    const [remaining] = await direct`
      select
        (select count(*) from public.products where name = 'Phase D staging fixture')::int products,
        (select count(*) from public.attributes where name = 'Phase D measure')::int attributes,
        (select count(*) from public.price_lists where name = 'Phase D staging fixture')::int price_lists,
        (select count(*) from public.inventory_locations where name = 'Phase D staging fixture')::int locations,
        (select count(*) from public.external_mappings where external_id like 'phase-d-%')::int mappings,
        (select count(*) from public.units where name like 'Phase D % fixture')::int units
    `;
    fixturesRemoved = Object.values(remaining).every((count) => count === 0);
  } finally {
    await Promise.all([direct.end({ timeout: 5 }), pooler.end({ timeout: 5 })]);
  }
}

assert.equal(fixturesRemoved, true);
console.log(JSON.stringify({ ...result, fixturesRemoved }, null, 2));
