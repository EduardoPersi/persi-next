import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");

const image = "public.ecr.aws/supabase/postgres:17.6.1.155";
const host = "127.0.0.1";
const container = `persi-security-r1-${crypto.randomBytes(6).toString("hex")}`;
const password = crypto.randomBytes(32).toString("base64url");
const securityVersion = "20260903130000";
const securityFilename = `${securityVersion}_public_browser_privilege_remediation.sql`;

function run(command, args, { input, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} failed (${code}): ${quiet ? "output redacted" : `${stderr.trim()}\n${stdout.trim()}`}`)));
    child.stdin.end(input);
  });
}

const psqlArgs = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1", "-At"];
async function sql(statement) {
  const result = await run("docker", psqlArgs, { input: `${statement}\n` });
  return result.stdout.trim();
}
async function apply(filename) {
  await run("docker", psqlArgs, { input: fs.readFileSync(`supabase/migrations/${filename}`, "utf8") });
  await sql(`insert into supabase_migrations.schema_migrations(version) values('${filename.slice(0, 14)}');`);
}

const dangerousSql = `
with roles(role_name) as (values ('anon'),('authenticated')),
privileges(privilege_name) as (values ('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN'))
select role_name||':'||privilege_name||'='||count(*) filter (
  where has_table_privilege(role_name,relation.oid,privilege_name)
)
from roles cross join privileges cross join pg_class relation
join pg_namespace namespace on namespace.oid=relation.relnamespace
where namespace.nspname='public' and relation.relkind='r'
group by role_name,privilege_name order by role_name,privilege_name;`;
const unsafeDefaultSql = `select count(*) from pg_default_acl defaults
join pg_namespace namespace on namespace.oid=defaults.defaclnamespace
cross join lateral aclexplode(defaults.defaclacl) privilege
where defaults.defaclrole='postgres'::regrole and namespace.nspname='public'
and defaults.defaclobjtype='r' and pg_get_userbyid(privilege.grantee) in ('anon','authenticated')
and privilege.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN');`;
const targetedExposureSql = `select count(*) from pg_proc function join pg_namespace namespace on namespace.oid=function.pronamespace
where namespace.nspname='public' and function.proname in (
'adjust_inventory','capture_price_history','catalog_search','confirm_inventory_reservation','immutable_unaccent_lower',
'prevent_overlapping_prices','refresh_catalog_search_document','release_inventory_reservation','reserve_inventory',
'rls_auto_enable','set_updated_at','validate_attribute_assignment','validate_attribute_value_shape',
'validate_measurement_component','validate_product_media_variant','validate_product_publication')
and (has_function_privilege('anon',function.oid,'EXECUTE') or has_function_privilege('authenticated',function.oid,'EXECUTE'));`;
const technicalAclSql = `select md5(coalesce(string_agg(entry,'|' order by entry),'')) from (
select relation.relname||':'||role.rolname||':'||privilege.privilege_type entry
from pg_class relation join pg_namespace namespace on namespace.oid=relation.relnamespace
cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) privilege
join pg_roles role on role.oid=privilege.grantee where namespace.nspname='public' and relation.relkind='r'
and role.rolname in ('persi_app','persi_worker') union all
select function.oid::regprocedure::text||':'||role.rolname||':'||privilege.privilege_type
from pg_proc function join pg_namespace namespace on namespace.oid=function.pronamespace
cross join lateral aclexplode(coalesce(function.proacl,acldefault('f',function.proowner))) privilege
join pg_roles role on role.oid=privilege.grantee where namespace.nspname='public'
and role.rolname in ('persi_app','persi_worker')) entries;`;
const dataSql = `select json_build_array(
(select count(*) from products),(select count(*) from product_variants),(select count(*) from prices),
(select coalesce(sum(quantity_on_hand),0) from inventory_levels),(select coalesce(sum(quantity_reserved),0) from inventory_levels),
(select count(*) from pim_suggestions),(select count(*) from pim_product_profiles),(select count(*) from pim_conflicts),
(select count(*) from shipping_methods),(select count(*) from shipments),(select count(*) from stores));`;
const eventProbe = (name) => `begin; create table public.${name}(id bigint);
select relrowsecurity||','||has_table_privilege('anon','public.${name}','TRUNCATE')
from pg_class where oid='public.${name}'::regclass; rollback;`;

const port = await new Promise((resolve, reject) => {
  const server = net.createServer(); server.unref(); server.on("error", reject);
  server.listen(0, host, () => { const address = server.address(); server.close(() => resolve(address.port)); });
});
let created = false;
try {
  await run("docker", ["image", "inspect", image]);
  await run("docker", ["run", "-d", "--pull", "never", "--name", container, "-p", `${host}:${port}:5432`,
    "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,size=1g", "-e", `POSTGRES_PASSWORD=${password}`, image], { quiet: true });
  created = true;
  let consecutiveReady = 0;
  for (let attempt = 0; attempt < 180; attempt++) {
    try {
      const logs = await run("docker", ["logs", container]);
      const probe = await run("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-Atc",
        "select (current_setting('server_version')='17.6' and to_regrole('anon') is not null)::text"]);
      consecutiveReady = logs.stdout.includes("PostgreSQL init process complete; ready for start up.") && probe.stdout.trim() === "true"
        ? consecutiveReady + 1 : 0;
      if (consecutiveReady >= 3) break;
    } catch { consecutiveReady = 0; }
    if (attempt === 179) throw new Error("DISPOSABLE_POSTGRES_NOT_READY");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await sql("create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key);");
  // Use the same official pre-migration bootstrap consumed by Supabase CLI.
  await sql(fs.readFileSync("supabase/roles.sql", "utf8"));
  // Hosted staging already removed browser SELECT/DML from postgres defaults;
  // SECURITY-R0 proved that only the four dangerous privileges remained.
  await sql(`alter default privileges for role postgres in schema public
    revoke select, insert, update, delete on tables from anon, authenticated;`);
  const migrations = fs.readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort();
  assert.equal(migrations.length, 33);
  assert.deepEqual(migrations.slice(migrations.indexOf(securityFilename) - 1, migrations.indexOf(securityFilename) + 2), [
    "20260903120000_store_price_authority_foundation.sql", securityFilename,
    "20260904010000_secure_checkout_pii_foundation.sql",
  ]);
  const historical = migrations.filter((name) => name < securityFilename);
  assert.equal(historical.length, 23);
  for (const filename of historical) await apply(filename);

  const before = {
    dangerous: await sql(dangerousSql), defaults: await sql(unsafeDefaultSql),
    functions: await sql(targetedExposureSql), technicalAcl: await sql(technicalAclSql), data: await sql(dataSql),
  };
  assert.match(before.dangerous, /anon:TRUNCATE=37/);
  assert.match(before.dangerous, /authenticated:MAINTAIN=37/);
  assert.equal(before.defaults, "8");
  assert.equal(before.functions, "15");

  await apply(securityFilename);
  const afterSecurity = {
    dangerous: await sql(dangerousSql), defaults: await sql(unsafeDefaultSql),
    functions: await sql(targetedExposureSql), technicalAcl: await sql(technicalAclSql), data: await sql(dataSql),
    eventTrigger: await sql(eventProbe("security_r1_before_b3c_probe")),
  };
  assert.doesNotMatch(afterSecurity.dangerous, /=([1-9][0-9]*)/);
  assert.equal(afterSecurity.defaults, "0");
  assert.equal(afterSecurity.functions, "0");
  assert.equal(afterSecurity.technicalAcl, before.technicalAcl);
  assert.equal(afterSecurity.data, before.data);
  assert.match(afterSecurity.eventTrigger, /(?:t,f|true,false)/);

  for (const filename of migrations.filter((name) => name > securityFilename)) await apply(filename);
  const final = {
    count: await sql("select count(*) from supabase_migrations.schema_migrations;"),
    securityCount: await sql(`select count(*) from supabase_migrations.schema_migrations where version='${securityVersion}';`),
    m31Count: await sql("select count(*) from supabase_migrations.schema_migrations where version='20260907180000';"),
    dangerous: await sql(dangerousSql), defaults: await sql(unsafeDefaultSql), functions: await sql(targetedExposureSql),
    browserDml: await sql(`with roles(role_name) as (values ('anon'),('authenticated')),
      privileges(privilege_name) as (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'))
      select count(*) from roles cross join privileges cross join pg_class relation
      join pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relkind='r'
      and has_table_privilege(role_name,relation.oid,privilege_name);`),
    browserCreate: await sql("select has_schema_privilege('anon','public','CREATE')::int+has_schema_privilege('authenticated','public','CREATE')::int;"),
    eventTrigger: await sql(eventProbe("security_r1_after_b3c_probe")),
  };
  assert.equal(final.count, "33"); assert.equal(final.securityCount, "1"); assert.equal(final.m31Count, "1");
  assert.doesNotMatch(final.dangerous, /=([1-9][0-9]*)/);
  assert.equal(final.defaults, "0"); assert.equal(final.functions, "0");
  assert.equal(final.browserDml, "0"); assert.equal(final.browserCreate, "0");
  assert.match(final.eventTrigger, /(?:t,f|true,false)/);

  await sql("create extension if not exists pgtap with schema extensions;");
  const pgTap = await run("docker", psqlArgs, {
    input: `set search_path=public,extensions;\n${fs.readFileSync("supabase/tests/database/public_browser_privilege_remediation.test.sql", "utf8")}`,
  });
  assert.doesNotMatch(pgTap.stdout, /not ok/i);

  console.log(JSON.stringify({ postgres: "17.6", historicalApplied: 23, before, afterSecurity, final, pgTap: "PASS" }, null, 2));
} finally {
  if (created) await run("docker", ["rm", "-f", container], { quiet: true }).catch(() => {});
}
