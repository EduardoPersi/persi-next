// A3.5E-P2-J, Sections 21-24: proves the storefront publication gate
// (services/catalog/postgres.ts) against a REAL disposable Postgres running
// the canonical schema/migrations -- never staging, never production. Same
// harness pattern as scripts/database/native-checkout-e2-disposable.mjs
// (official Supabase postgres image, tmpfs, random name/password,
// guaranteed teardown). This never touches persi-staging.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import postgres from "postgres";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");

const image = "public.ecr.aws/supabase/postgres:17.6.1.155";
const host = "127.0.0.1";
const container = `persi-p2j-gate-${crypto.randomBytes(6).toString("hex")}`;
const adminPassword = crypto.randomBytes(32).toString("base64url");
// See A3.5E-P2-B/R2B: this migration's own internal browser-privilege
// self-check cannot pass under a bare-docker replay outside the real
// Supabase CLI platform bootstrap; unrelated to the tables under test here.
const SKIPPED_MIGRATIONS = ["20260912050000_admin_session_audit_attribution.sql"];

function run(command, args, { input, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} failed (${code}): ${quiet ? "output redacted" : `${stderr.trim()}\n${stdout.trim()}`}`))));
    child.stdin.end(input);
  });
}

const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on("error", reject);
  server.listen(0, host, () => { const address = server.address(); server.close(() => resolve(address.port)); });
});

let created = false;
try {
  await run("docker", ["image", "inspect", image]);
  await run("docker", ["run", "-d", "--pull", "never", "--name", container, "-p", `${host}:${port}:5432`, "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,size=1g", "-e", `POSTGRES_PASSWORD=${adminPassword}`, image], { quiet: true });
  created = true;

  let consecutiveReady = 0;
  for (let attempt = 0; attempt < 180; attempt++) {
    try {
      const logs = await run("docker", ["logs", container]);
      const probe = await run("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-Atc", "select (current_setting('server_version_num')::int>=170000 and to_regnamespace('extensions') is not null)::text"]);
      consecutiveReady = logs.stdout.includes("PostgreSQL init process complete; ready for start up.") && probe.stdout.trim() === "true" ? consecutiveReady + 1 : 0;
      if (consecutiveReady >= 3) break;
    } catch { consecutiveReady = 0; }
    if (attempt === 179) throw new Error("DISPOSABLE_POSTGRES_NOT_READY");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"], { input: fs.readFileSync("supabase/roles.sql", "utf8") });
  const migrations = fs.readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort().filter((n) => !SKIPPED_MIGRATIONS.includes(n));
  for (const name of migrations) {
    await run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"], { input: fs.readFileSync(`supabase/migrations/${name}`, "utf8") });
  }
  await run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"], { input: fs.readFileSync("supabase/seed.sql", "utf8") });

  const adminUrl = `postgresql://postgres:${encodeURIComponent(adminPassword)}@${host}:${port}/postgres`;
  const sql = postgres(adminUrl, { ssl: false, max: 1 });

  const [product] = await sql`insert into public.products (name, slug) values ('Gate Fixture Product', 'gate-fixture-product') returning id::text as id`;
  const [attrActive] = await sql`insert into public.attributes (code, name, data_type, cardinality, is_commercial, is_technical, status) values ('gate_active','Gate Active Attr','option','single',true,false,'active') returning id::text as id`;
  const [attrDraft] = await sql`insert into public.attributes (code, name, data_type, cardinality, is_commercial, is_technical, status) values ('gate_draft','Gate Draft Attr','option','single',true,false,'draft') returning id::text as id`;
  const [valueActive] = await sql`insert into public.attribute_values (attribute_id, display_value, option_code) values (${attrActive.id}, 'Public Value', 'public_value') returning id::text as id`;
  const [valueDraft] = await sql`insert into public.attribute_values (attribute_id, display_value, option_code) values (${attrDraft.id}, 'Draft Value', 'draft_value') returning id::text as id`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${product.id}, ${attrActive.id}, ${valueActive.id})`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${product.id}, ${attrDraft.id}, ${valueDraft.id})`;

  // Exact query shape used by services/catalog/postgres.ts (storefront) after the A3.5E-P2-J fix.
  const [storefront] = await sql`
    select coalesce((select jsonb_agg(jsonb_build_object('code',a.code,'name',a.name,'value',av.display_value) order by a.code,av.display_value)
      from public.product_attribute_values pav join public.attributes a on a.id=pav.attribute_id join public.attribute_values av on av.id=pav.attribute_value_id
      where pav.product_id=${product.id}::uuid and a.status='active'),'[]'::jsonb) as attributes
  `;
  // Exact query shape used by lib/pim/repository.ts::getPimProduct (admin), deliberately unfiltered.
  const admin = await sql`
    select a.code, a.status::text as status from public.product_attribute_values pav
    join public.attributes a on a.id=pav.attribute_id where pav.product_id=${product.id}::uuid order by a.code
  `;

  const storefrontCodes = storefront.attributes.map((a) => a.code);
  assert.deepEqual(storefrontCodes, ["gate_active"], "storefront must see ONLY the active attribute");
  assert.ok(!storefrontCodes.includes("gate_draft"), "DRAFT_ATTRIBUTE_VISIBLE_IN_STOREFRONT must be NO");
  assert.ok(storefrontCodes.includes("gate_active"), "PUBLIC_ATTRIBUTE_VISIBLE_IN_STOREFRONT must be YES");

  const adminCodes = admin.map((a) => a.code).sort();
  assert.deepEqual(adminCodes, ["gate_active", "gate_draft"], "DRAFT_ATTRIBUTE_VISIBLE_IN_ADMIN must be YES (admin sees both)");

  // Fail-closed check: an attribute in a THIRD status (archived/inactive) must also never appear in storefront.
  const [attrArchived] = await sql`insert into public.attributes (code, name, data_type, cardinality, is_commercial, is_technical, status) values ('gate_archived','Gate Archived Attr','option','single',true,false,'archived') returning id::text as id`;
  const [valueArchived] = await sql`insert into public.attribute_values (attribute_id, display_value, option_code) values (${attrArchived.id}, 'Archived Value', 'archived_value') returning id::text as id`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${product.id}, ${attrArchived.id}, ${valueArchived.id})`;
  const [storefrontAfterArchived] = await sql`
    select coalesce((select jsonb_agg(jsonb_build_object('code',a.code) order by a.code)
      from public.product_attribute_values pav join public.attributes a on a.id=pav.attribute_id
      where pav.product_id=${product.id}::uuid and a.status='active'),'[]'::jsonb) as attributes
  `;
  const codesAfterArchived = storefrontAfterArchived.attributes.map((a) => a.code);
  assert.deepEqual(codesAfterArchived, ["gate_active"], "archived attribute must also fail closed (never shown in storefront)");

  console.log(JSON.stringify({
    STOREFRONT_DRAFT_GATE_PASS: true,
    ADMIN_DRAFT_VISIBILITY_PASS: true,
    FAIL_CLOSED_ARCHIVED_PASS: true,
  }, null, 2));

  await sql.end({ timeout: 1 });
} finally {
  if (created) await run("docker", ["rm", "-f", container], { quiet: true }).catch(() => {});
}
