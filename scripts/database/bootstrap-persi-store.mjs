import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";

export const STAGING_PROJECT_REF = "vtrujmhhkmvjzfklzxip";
export const APPLY_CONFIRMATION = "persi-store-bootstrap";
export const PERSI_BOOTSTRAP = Object.freeze({
  storeCode: "persi",
  storeName: "Persi Materiais de Construção",
  storeStatus: "active",
  currency: "BRL",
  timezone: "America/Sao_Paulo",
  context: "storefront_retail",
  assignmentVersion: 1n,
  priceListCode: "woo-brl",
  priceListId: "bc5547d9-b7ff-4714-84e4-c9cb149b7408",
});

const invariantTables = [
  "price_lists", "prices", "products", "product_variants", "inventory_levels",
  "inventory_reservations", "inventory_movements", "customers", "carts", "cart_items",
  "checkout_sessions", "checkout_session_items", "checkout_shipping_quotes", "orders",
  "order_items", "order_addresses", "order_adjustments", "order_status_events",
  "pim_suggestions", "pim_product_profiles", "pim_attribute_reviews", "pim_audit_log",
  "pim_conflicts", "product_media", "external_mappings", "shipping_methods", "shipments",
  "shipment_events", "shipping_provider_credentials", "shipping_quote_cache",
];

function parseCli(argv) {
  const allowed = new Set(["--local", "--apply", `--confirm=${APPLY_CONFIRMATION}`]);
  for (const argument of argv) if (!allowed.has(argument)) throw new Error(`UNKNOWN_ARGUMENT:${argument}`);
  const local = argv.includes("--local");
  const apply = argv.includes("--apply");
  const confirmed = argv.includes(`--confirm=${APPLY_CONFIRMATION}`);
  if (apply && !confirmed) throw new Error("APPLY_CONFIRMATION_REQUIRED");
  if (confirmed && !apply) throw new Error("APPLY_FLAG_REQUIRED");
  return { local, apply };
}

function secret(name) {
  for (const file of [".env.staging.local", ".env.local"]) {
    if (!fs.existsSync(file)) continue;
    const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  throw new Error(`${name}_MISSING`);
}

function cliConnection(local) {
  if (local) return { target: "local", projectRef: null, url: localDatabaseUrl() };
  const template = fs.readFileSync("supabase/.temp/pooler-url", "utf8").trim();
  assert.ok(template.includes(STAGING_PROJECT_REF), "WRONG_PROJECT_REF");
  assert.ok(!/prod(uction)?/i.test(template), "PRODUCTION_CONNECTION_FORBIDDEN");
  const url = new URL(template);
  url.password = secret("PERSI_STAGING_DB_PASSWORD");
  return { target: "persi-staging", projectRef: STAGING_PROJECT_REF, url: url.toString() };
}

async function tableCounts(tx) {
  const result = {};
  for (const table of invariantTables) {
    const [{ present }] = await tx`select to_regclass(${`public.${table}`}) is not null present`;
    result[table] = present ? Number((await tx.unsafe(`select count(*)::bigint count from public.${table}`))[0].count) : null;
  }
  return result;
}

async function priceCoverage(tx, config) {
  const [coverage] = await tx`
    with eligible as (
      select id from public.product_variants where status='active'
    ), candidates as (
      select e.id,count(p.id)::int candidates
      from eligible e left join public.prices p
        on p.product_variant_id=e.id and p.price_list_id=${config.priceListId}::uuid
       and p.status='active' and p.currency=${config.currency}
       and p.valid_from<=transaction_timestamp() and (p.valid_to is null or p.valid_to>transaction_timestamp())
      group by e.id
    )
    select count(*)::int "eligibleVariants",
      count(*) filter(where candidates=1)::int "pricedVariants",
      count(*) filter(where candidates=0)::int missing,
      count(*) filter(where candidates>1)::int ambiguous
    from candidates`;
  const [quality] = await tx`
    select
      count(*) filter(where status='active' and currency<>${config.currency})::int invalid,
      count(*) filter(where sale_amount_minor is not null
        and (sale_valid_from is null or sale_valid_from<=transaction_timestamp())
        and (sale_valid_to is null or sale_valid_to>transaction_timestamp()))::int sales
    from public.prices where price_list_id=${config.priceListId}::uuid`;
  return { ...coverage, ...quality };
}

async function inspectLocked(tx, config) {
  const migrations = await tx`select version from supabase_migrations.schema_migrations order by version`;
  assert.equal(migrations.length, 23, "MIGRATION_COUNT_MISMATCH");
  assert.equal(migrations.at(-1)?.version, "20260903120000", "MIGRATION_HEAD_MISMATCH");
  const lists = await tx`select id::text,code,currency,channel,status::text,customer_segment,priority from public.price_lists where code=${config.priceListCode} or id=${config.priceListId}::uuid order by id`;
  assert.equal(lists.length, 1, "PRICE_LIST_DOUBLE_IDENTITY_MISMATCH");
  const list = lists[0];
  assert.equal(list.id, config.priceListId, "PRICE_LIST_UUID_MISMATCH");
  assert.equal(list.code, config.priceListCode, "PRICE_LIST_CODE_MISMATCH");
  assert.equal(list.currency, config.currency, "PRICE_LIST_CURRENCY_MISMATCH");
  assert.equal(list.channel, "storefront", "PRICE_LIST_CHANNEL_MISMATCH");
  assert.equal(list.status, "active", "PRICE_LIST_INACTIVE");
  const coverage = await priceCoverage(tx, config);
  assert.equal(coverage.pricedVariants, coverage.eligibleVariants, "PRICE_COVERAGE_INCOMPLETE");
  assert.equal(coverage.missing, 0, "PRICE_COVERAGE_MISSING");
  assert.equal(coverage.ambiguous, 0, "PRICE_COVERAGE_AMBIGUOUS");
  assert.equal(coverage.invalid, 0, "PRICE_CURRENCY_INVALID");
  const stores = await tx`select id::text,code,name,status::text,default_currency,timezone,next_order_sequence from public.stores where code=${config.storeCode} or name=${config.storeName} order by id`;
  const [{ count: assignmentCount }] = await tx`select count(*)::int count from public.store_price_list_assignments`;
  const resolver = await tx`select count(*)::int count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolve_store_price_authority'`;
  assert.equal(resolver[0].count, 1, "P1_RESOLVER_MISSING");
  return { migrations: migrations.length, list, coverage, stores, assignmentCount };
}

function exactStore(store, config) {
  return store.code === config.storeCode && store.name === config.storeName &&
    store.status === config.storeStatus && store.default_currency === config.currency &&
    store.timezone === config.timezone && BigInt(store.next_order_sequence) === 1n;
}

async function existingBootstrap(tx, inspection, config) {
  if (inspection.stores.length === 0) return null;
  if (inspection.stores.length !== 1 || !exactStore(inspection.stores[0], config)) throw new Error("BOOTSTRAP_CONFLICT");
  const store = inspection.stores[0];
  const assignments = await tx`
    select id::text,store_id::text,price_list_id::text,currency,commercial_context::text,
      version,valid_from,valid_to
    from public.store_price_list_assignments where store_id=${store.id}::uuid order by version`;
  if (assignments.length !== 1) throw new Error("BOOTSTRAP_CONFLICT");
  const assignment = assignments[0];
  if (assignment.price_list_id !== config.priceListId || assignment.currency !== config.currency ||
      assignment.commercial_context !== config.context || BigInt(assignment.version) !== config.assignmentVersion ||
      assignment.valid_to !== null || new Date(assignment.valid_from) > new Date()) throw new Error("BOOTSTRAP_CONFLICT");
  return { store, assignment };
}

export async function runPersiBootstrap(sql, options = {}) {
  const config = options.config ?? PERSI_BOOTSTRAP;
  const apply = options.apply === true;
  const environment = options.environment ?? { target: "local", projectRef: null };
  if (environment.target !== "local") {
    assert.equal(environment.target, "persi-staging", "WRONG_TARGET");
    assert.equal(environment.projectRef, STAGING_PROJECT_REF, "WRONG_PROJECT_REF");
  }
  const execute = async (tx) => {
    if (!apply) await tx`set transaction read only`;
    if (apply) await tx`select pg_advisory_xact_lock(hashtextextended('persi-store-bootstrap',0))`;
    const inspection = await inspectLocked(tx, config);
    const existing = await existingBootstrap(tx, inspection, config);
    if (existing) return { status: "ALREADY_BOOTSTRAPPED", mode: apply ? "APPLY" : "DRY_RUN", writes: 0, ...inspection, ...existing };
    if (!apply) return {
      status: "READY_TO_APPLY", mode: "DRY_RUN", writes: 0, ...inspection,
      intendedStore: { code: config.storeCode, name: config.storeName, status: config.storeStatus, currency: config.currency, timezone: config.timezone, nextOrderSequence: "1" },
      intendedAssignment: { priceListCode: config.priceListCode, priceListId: config.priceListId, currency: config.currency, context: config.context, version: "1", validFrom: "transaction_timestamp()", validTo: null },
      expectedMutations: { stores: 1, assignments: 1 },
    };
    const before = await tableCounts(tx);
    const [store] = await tx`insert into public.stores(code,name,status,default_currency,timezone,next_order_sequence) values
      (${config.storeCode},${config.storeName},${config.storeStatus},${config.currency},${config.timezone},1) returning id::text,code,name,status::text,default_currency,timezone,next_order_sequence`;
    if (options.injectFailureAfterStore) throw new Error("INJECTED_AFTER_STORE");
    const [assignment] = await tx`insert into public.store_price_list_assignments(store_id,price_list_id,currency,commercial_context,version,valid_from,valid_to) values
      (${store.id}::uuid,${config.priceListId}::uuid,${config.currency},${config.context},${config.assignmentVersion},transaction_timestamp(),null)
      returning id::text,store_id::text,price_list_id::text,currency,commercial_context::text,version,valid_from,valid_to`;
    const resolved = await tx`select assignment_id::text,assignment_version,price_list_id::text,currency,commercial_context::text from public.resolve_store_price_authority(${store.id}::uuid,${config.currency},${config.context},transaction_timestamp())`;
    assert.equal(resolved.length, 1, "RESOLVER_COUNT_MISMATCH");
    assert.equal(resolved[0].assignment_id, assignment.id, "RESOLVER_ASSIGNMENT_MISMATCH");
    assert.equal(resolved[0].price_list_id, config.priceListId, "RESOLVER_LIST_MISMATCH");
    assert.equal(BigInt(resolved[0].assignment_version), config.assignmentVersion, "RESOLVER_VERSION_MISMATCH");
    const after = await tableCounts(tx);
    for (const table of invariantTables) assert.equal(after[table], before[table], `${table.toUpperCase()}_CHANGED`);
    const [{ stores, assignments }] = await tx`select (select count(*)::int from public.stores) stores,(select count(*)::int from public.store_price_list_assignments) assignments`;
    return { status: "BOOTSTRAPPED", mode: "APPLY", writes: 2, migrations: inspection.migrations, list: inspection.list, coverage: inspection.coverage, store, assignment, resolver: resolved[0], finalCounts: { stores, assignments } };
  };
  return options.useExistingTransaction ? execute(sql) : sql.begin(execute);
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const connection = cliConnection(options.local);
  if (options.apply && !options.local && (connection.target !== "persi-staging" || connection.projectRef !== STAGING_PROJECT_REF)) throw new Error("STAGING_IDENTITY_REQUIRED");
  const sql = postgres(connection.url, { max: 4, prepare: false, ssl: options.local ? false : "require", connect_timeout: 20 });
  try {
    const result = await runPersiBootstrap(sql, { apply: options.apply, environment: connection });
    const report = {
      target: connection.target,
      projectRef: connection.projectRef,
      mode: result.mode,
      status: result.status,
      writes: result.writes,
      migrations: result.migrations,
      existingMatchingStores: result.stores?.length ?? (result.store ? 1 : 0),
      existingAssignments: result.assignmentCount ?? (result.assignment ? 1 : 0),
      priceList: result.list,
      coverage: result.coverage,
      intendedStore: result.intendedStore,
      intendedAssignment: result.intendedAssignment,
      expectedMutations: result.expectedMutations,
      finalCounts: result.finalCounts,
    };
    console.log(JSON.stringify(report, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
  } finally { await sql.end({ timeout: 5 }); }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
