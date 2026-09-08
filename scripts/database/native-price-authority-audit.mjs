import assert from "node:assert/strict";
import fs from "node:fs";
import postgres from "postgres";
import { localDatabaseUrl } from "./local-database.mjs";

const local = process.argv.includes("--local");
const projectRef = "vtrujmhhkmvjzfklzxip";
let connection = localDatabaseUrl();

if (!local) {
  const envPath = fs.existsSync(".env.staging.local") ? ".env.staging.local" : ".env.local";
  const secret = fs.readFileSync(envPath, "utf8").split(/\r?\n/)
    .find((line) => line.startsWith("PERSI_STAGING_DB_PASSWORD="));
  assert.ok(secret, "PERSI_STAGING_DB_PASSWORD_MISSING");
  const template = fs.readFileSync("supabase/.temp/pooler-url", "utf8").trim();
  assert.ok(template.includes(projectRef), "WRONG_PROJECT_REF");
  assert.ok(!/prod(uction)?/i.test(template), "PRODUCTION_SELECTED");
  const url = new URL(template);
  url.password = secret.slice(secret.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  connection = url.toString();
}

const sql = postgres(connection, { max: 1, prepare: false, ssl: local ? false : "require", connect_timeout: 20 });

try {
  const result = await sql.begin(async (tx) => {
    await tx`set transaction read only`;
    const [identity] = await tx`select current_setting('transaction_read_only') "readOnly", current_database() database, current_user role, version()`;
    assert.equal(identity.readOnly, "on");
    if (!local) assert.match(identity.version, /PostgreSQL 17\.6/);

    const migrations = await tx`select version from supabase_migrations.schema_migrations order by version`;
    const [counts] = await tx`
      select
        (select count(*)::int from stores) stores,
        (select count(*)::int from price_lists) price_lists,
        (select count(*)::int from prices) prices,
        (select count(*)::int from product_variants) variants,
        (select count(*)::int from carts) carts,
        (select count(*)::int from checkout_sessions) checkouts,
        (select count(*)::int from orders) orders
    `;
    const [p1] = await tx`
      select to_regclass('public.store_price_list_assignments') is not null "assignmentTable",
        exists(select 1 from information_schema.columns where table_schema='public' and table_name='checkout_sessions' and column_name='store_price_list_assignment_id') "checkoutSnapshot",
        exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolve_store_price_authority') resolver
    `;
    const lists = await tx`
      select pl.id::text, pl.code, pl.currency, pl.channel, pl.customer_segment "customerSegment",
        pl.priority, pl.status::text,
        count(p.id)::int "priceCount",
        count(distinct p.product_variant_id)::int "variantCoverage"
      from price_lists pl left join prices p on p.price_list_id=pl.id
      group by pl.id order by pl.code
    `;
    const currencies = await tx`select currency, count(*)::int lists from price_lists group by currency order by currency`;
    const [quality] = await tx`
      select
        count(*) filter(where pl.id is null)::int "pricesWithoutList",
        count(*) filter(where p.status='active' and (p.valid_from>now() or (p.valid_to is not null and p.valid_to<=now())))::int "activeButNotCurrentlyValid",
        count(*) filter(where p.status='active' and p.valid_from<=now() and (p.valid_to is null or p.valid_to>now()))::int "currentlyValidPrices",
        count(*) filter(where p.sale_amount_minor is not null)::int "salePrices",
        count(*) filter(where p.sale_amount_minor is not null and (p.sale_valid_from is null or p.sale_valid_from<=now()) and (p.sale_valid_to is null or p.sale_valid_to>now()))::int "currentlyActiveSales",
        count(*) filter(where p.sale_amount_minor is not null and p.sale_valid_from>now())::int "futureSales",
        count(*) filter(where p.sale_amount_minor is not null and p.sale_valid_to is not null and p.sale_valid_to<=now())::int "expiredSales"
      from prices p left join price_lists pl on pl.id=p.price_list_id
    `;
    const [coverage] = await tx`
      with usable as (
        select p.product_variant_id,p.price_list_id,count(*)::int candidates
        from prices p join price_lists pl on pl.id=p.price_list_id
        where p.status='active' and pl.status='active' and p.currency=pl.currency
          and p.valid_from<=now() and (p.valid_to is null or p.valid_to>now())
        group by p.product_variant_id,p.price_list_id
      ), per_variant as (
        select product_variant_id,sum(candidates)::int candidates,count(*)::int lists
        from usable group by product_variant_id
      )
      select
        count(*) filter(where coalesce(v.candidates,0)>0)::int "pricedVariants",
        count(*) filter(where coalesce(v.candidates,0)=0)::int missing,
        count(*) filter(where v.candidates>1)::int "ambiguousWithinList",
        count(*) filter(where v.lists>1)::int "multipleUsableLists"
      from product_variants pv left join per_variant v on v.product_variant_id=pv.id
    `;
    const overlaps = await tx`
      select a.product_variant_id::text,a.price_list_id::text,count(*)::int pairs
      from prices a join prices b on b.product_variant_id=a.product_variant_id and b.price_list_id=a.price_list_id and b.id>a.id
      where a.status='active' and b.status='active'
        and tstzrange(a.valid_from,a.valid_to,'[)') && tstzrange(b.valid_from,b.valid_to,'[)')
      group by a.product_variant_id,a.price_list_id
    `;
    const domainTables = ["products","product_variants","customers","carts","cart_items","checkout_sessions","checkout_session_items","checkout_shipping_quotes","orders","order_items","order_addresses","order_adjustments","order_status_events","inventory_levels","inventory_reservations","inventory_movements","pim_suggestions","pim_product_profiles","pim_attribute_reviews","pim_audit_log","pim_conflicts","product_media","external_mappings","shipping_methods","shipments","shipment_events","shipping_provider_credentials","shipping_quote_cache","store_price_list_assignments"];
    const domainCounts = {};
    for (const table of domainTables) {
      const [{ present }] = await tx`select to_regclass(${`public.${table}`}) is not null present`;
      domainCounts[table] = present ? Number((await tx.unsafe(`select count(*)::bigint count from public.${table}`))[0].count) : null;
    }
    const enumValues = await tx`select e.enumlabel value from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid where n.nspname='public' and t.typname='commercial_context' order by e.enumsortorder`;
    const functions = await tx`
      select p.proname,pg_get_function_identity_arguments(p.oid) arguments,p.prosecdef,
        pg_get_userbyid(p.proowner) owner,coalesce(array_to_string(p.proconfig,','),'') config,
        has_function_privilege('public',p.oid,'execute') "publicExecute",
        has_function_privilege('anon',p.oid,'execute') "anonExecute",
        has_function_privilege('authenticated',p.oid,'execute') "authenticatedExecute",
        has_function_privilege('persi_app',p.oid,'execute') "appExecute",
        has_function_privilege('persi_worker',p.oid,'execute') "workerExecute",
        has_function_privilege('persi_readonly',p.oid,'execute') "readonlyExecute"
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('enforce_store_price_assignment_history','resolve_store_price_authority','validate_checkout_price_authority')
      order by p.proname`;
    const triggers = await tx`
      select c.relname table_name,t.tgname trigger_name,p.proname function_name,pg_get_triggerdef(t.oid) definition
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid
      where n.nspname='public' and not t.tgisinternal and t.tgname in ('store_price_assignments_history_guard','checkout_sessions_price_authority')
      order by t.tgname`;
    const assignmentSecurity = await tx`
      select c.relrowsecurity "rlsEnabled",
        has_table_privilege('public',c.oid,'select,insert,update,delete') "publicDml",
        has_table_privilege('anon',c.oid,'select,insert,update,delete') "anonDml",
        has_table_privilege('authenticated',c.oid,'select,insert,update,delete') "authenticatedDml",
        has_table_privilege('persi_app',c.oid,'insert,update,delete') "appDml",
        has_table_privilege('persi_worker',c.oid,'insert,update,delete') "workerDml",
        has_table_privilege('persi_readonly',c.oid,'select,insert,update,delete') "readonlyDml"
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='store_price_list_assignments'`;
    const assignmentPolicies = await tx`select policyname,roles,cmd from pg_policies where schemaname='public' and tablename='store_price_list_assignments' order by policyname`;
    const columns = await tx`
      select table_name,column_name,data_type,udt_name,is_nullable,column_default
      from information_schema.columns
      where table_schema='public' and table_name in ('stores','price_lists','prices','products','product_variants','carts','checkout_sessions','checkout_session_items','store_price_list_assignments')
      order by table_name,ordinal_position
    `;
    const constraints = await tx`
      select c.relname table_name,k.conname,k.contype,pg_get_constraintdef(k.oid) definition
      from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('stores','price_lists','prices','products','product_variants','carts','checkout_sessions','checkout_session_items','store_price_list_assignments')
      order by c.relname,k.conname
    `;
    const indexes = await tx`
      select tablename,indexname,indexdef from pg_indexes
      where schemaname='public' and tablename in ('stores','price_lists','prices','products','product_variants','carts','checkout_sessions','checkout_session_items','store_price_list_assignments')
      order by tablename,indexname
    `;
    return { target: local ? "local" : "persi-staging", projectRef: local ? null : projectRef, identity, migrations: migrations.map((row) => row.version), p1, counts, domainCounts, lists, currencies, quality, coverage, overlapCount: overlaps.length, enumValues, functions, triggers, assignmentSecurity, assignmentPolicies, columns, constraints, indexes };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
