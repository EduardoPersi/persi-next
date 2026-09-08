import assert from "node:assert/strict";
import fs from "node:fs";
import postgres from "postgres";

const projectRef = "vtrujmhhkmvjzfklzxip";
const expectedTarget = "persi-staging";
const envFile = fs.existsSync(".env.staging.local") ? ".env.staging.local" : ".env.local";
const passwordLine = fs.readFileSync(envFile, "utf8").split(/\r?\n/)
  .find((line) => line.startsWith("PERSI_STAGING_DB_PASSWORD="));
assert.ok(passwordLine, "PERSI_STAGING_DB_PASSWORD_MISSING");
const password = passwordLine.slice(passwordLine.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
const template = fs.readFileSync("supabase/.temp/pooler-url", "utf8").trim();
assert.ok(template.includes(projectRef), "WRONG_PROJECT_REF");
assert.ok(!/prod(uction)?/i.test(template), "PRODUCTION_CONNECTION_SELECTED");
const url = new URL(template);
url.password = password;
const sql = postgres(url.toString(), { max: 1, prepare: false, ssl: "require", connect_timeout: 20 });

const tables = [
  "products", "product_variants", "prices", "inventory_levels", "inventory_reservations",
  "inventory_movements", "stores", "customers", "customer_identities", "customer_addresses",
  "carts", "cart_items", "pim_suggestions", "pim_product_profiles", "pim_attribute_reviews",
  "pim_audit_log", "pim_conflicts", "product_media", "external_mappings", "shipping_methods",
  "shipments", "shipment_events", "shipping_provider_credentials", "shipping_quote_cache",
  "checkout_sessions", "checkout_session_items", "checkout_shipping_quotes",
];

try {
  const [identity] = await sql`select current_database() database, current_user role, version()`;
  assert.equal(identity.database, "postgres");
  assert.match(identity.version, /PostgreSQL 17\.6/);
  const counts = {};
  for (const table of tables) {
    const [exists] = await sql`select to_regclass(${`public.${table}`}) is not null as present`;
    counts[table] = exists.present ? Number((await sql.unsafe(`select count(*)::bigint as count from public.${table}`))[0].count) : null;
  }
  const migrations = await sql`select version from supabase_migrations.schema_migrations order by version`;
  const inventoryColumns = await sql`select column_name,data_type,udt_name,is_nullable from information_schema.columns where table_schema='public' and table_name='inventory_reservations' order by ordinal_position`;
  const inventoryConstraints = await sql`select conname,contype,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.inventory_reservations'::regclass order by conname`;
  const inventoryIndexes = await sql`select indexname,indexdef from pg_indexes where schemaname='public' and tablename='inventory_reservations' order by indexname`;
  const cartConstraints = await sql`select conname,contype,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.carts'::regclass order by conname`;
  const cartIndexes = await sql`select indexname,indexdef from pg_indexes where schemaname='public' and tablename='carts' order by indexname`;
  const checkoutTables = await sql`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('checkout_sessions','checkout_session_items','checkout_shipping_quotes') and c.relkind='r' order by c.relname`;
  const checkoutEnum = await sql`select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname='checkout_session_status' order by e.enumsortorder`;
  const functions = await sql`select p.proname,p.prosecdef,pg_get_userbyid(p.proowner) owner,coalesce(array_to_string(p.proconfig,','),'') config,has_function_privilege('public',p.oid,'execute') public_execute,has_function_privilege('anon',p.oid,'execute') anon_execute,has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,has_function_privilege('persi_app',p.oid,'execute') app_execute,has_function_privilege('persi_worker',p.oid,'execute') worker_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('validate_checkout_session_cart','enforce_checkout_status_transition','enforce_checkout_snapshot_mutability','prepare_native_checkout','close_native_checkout') order by p.proname`;
  const triggers = await sql`select c.relname table_name,t.tgname trigger_name,p.proname function_name from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid where n.nspname='public' and not t.tgisinternal and (c.relname like 'checkout_%' or p.proname like '%checkout%') order by c.relname,t.tgname`;
  const policies = await sql`select tablename,policyname,roles,cmd from pg_policies where schemaname='public' and tablename in ('checkout_sessions','checkout_session_items','checkout_shipping_quotes') order by tablename,policyname`;
  const checkoutIndexes = await sql`select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('checkout_sessions','checkout_session_items','checkout_shipping_quotes') order by tablename,indexname`;
  const checkoutColumns = await sql`select table_name,column_name,data_type,udt_name,is_nullable from information_schema.columns where table_schema='public' and table_name in ('checkout_sessions','checkout_session_items','checkout_shipping_quotes') order by table_name,ordinal_position`;
  const checkoutConstraints = await sql`select c.relname table_name,k.conname,k.contype,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('checkout_sessions','checkout_session_items','checkout_shipping_quotes') order by c.relname,k.conname`;
  const tableGrants = await sql`select table_name,grantee,string_agg(privilege_type,',' order by privilege_type) privileges from information_schema.role_table_grants where table_schema='public' and table_name in ('checkout_sessions','checkout_session_items','checkout_shipping_quotes') group by table_name,grantee order by table_name,grantee`;
  const inventoryFunctions = await sql`select proname,count(*)::int overloads from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('reserve_inventory','release_inventory_reservation','confirm_inventory_reservation') group by proname order by proname`;
  console.log(JSON.stringify({ target: expectedTarget, projectRef, postgres: "17.6", identity, migrations: migrations.map((row) => row.version), counts, inventoryColumns, inventoryConstraints, inventoryIndexes, cartConstraints, cartIndexes, checkoutTables, checkoutEnum: checkoutEnum.map((row) => row.enumlabel), functions, triggers, policies, checkoutIndexes, checkoutColumns, checkoutConstraints, tableGrants, inventoryFunctions }, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
