import fs from "node:fs";
import postgres from "postgres";
import { readPrivateEnvironment, stagingDirectUrl, STAGING_PROJECT_REF } from "./config.mjs";

if (!process.argv.includes("--staging") || !process.argv.includes("--approved-migration")) {
  throw new Error("Exige --staging --approved-migration.");
}
if (STAGING_PROJECT_REF !== "vtrujmhhkmvjzfklzxip") throw new Error("TARGET_NOT_APPROVED");

const version = "20260827133500";
const name = "price_history_single_writer_cleanup";
const path = `supabase/migrations/${version}_${name}.sql`;
const body = fs.readFileSync(path, "utf8");
const sql = postgres(stagingDirectUrl(readPrivateEnvironment().stagingPassword), {
  max: 1,
  prepare: false,
  ssl: "require",
  connect_timeout: 15,
});

const snapshot = async (connection) => {
  const [row] = await connection`
    select
      (select count(*)::int from public.price_history) price_history,
      (select count(*)::int from public.prices) prices,
      (select count(*)::int from public.products) products,
      (select count(*)::int from public.product_variants) variants,
      (select count(*)::int from public.inventory_levels) inventory_levels,
      (select count(*)::int from public.inventory_movements) inventory_movements,
      (select count(*)::int from public.external_mappings) external_mappings
  `;
  return row;
};

try {
  const [identity] = await sql`
    select current_database() database,
      exists(select 1 from supabase_migrations.schema_migrations where version=${version}) applied
  `;
  if (identity.database !== "postgres") throw new Error("TARGET_MISMATCH");
  const before = await snapshot(sql);
  if (!identity.applied) {
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values(${version},${name},${[body]})`;
    });
  }
  const after = await snapshot(sql);
  const [structure] = await sql`
    select
      (select count(*)::int from supabase_migrations.schema_migrations) migrations,
      (select count(*)::int from pg_trigger where tgrelid='public.prices'::regclass and tgname='prices_capture_history' and not tgisinternal) history_triggers,
      (select count(*)::int from pg_tables where schemaname='public') tables,
      (select count(*)::int from pg_tables where schemaname='public' and rowsecurity) rls,
      (select count(*)::int from pg_policies where schemaname='public') policies
  `;
  console.log(JSON.stringify({
    target: `persi-staging:${STAGING_PROJECT_REF}`,
    migration: `${version}_${name}`,
    alreadyApplied: identity.applied,
    before,
    after,
    removedHistoryRows: before.price_history - after.price_history,
    structure,
  }, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
