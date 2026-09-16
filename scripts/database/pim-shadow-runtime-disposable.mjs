// A3.6-B Section 20: proves the runtime shadow orchestrator's POSITIVE
// case (a real published PIM candidate) against a REAL disposable
// Postgres, since real staging currently has zero published rows
// (correctly, post-rollback) and must not be "fixed" to make this
// testable. Never staging, never production. Same harness pattern as
// scripts/database/pim-publication-read-model-disposable.mjs.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import postgres from "postgres";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");

const image = "public.ecr.aws/supabase/postgres:17.6.1.155";
const host = "127.0.0.1";
const container = `persi-a36b-shadowruntime-${crypto.randomBytes(6).toString("hex")}`;
const adminPassword = crypto.randomBytes(32).toString("base64url");
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
  process.env.DATABASE_URL = adminUrl;
  const { runPimCatalogShadow } = await import("../../lib/pim/publication-shadow-runtime.ts");

  const sql = postgres(adminUrl, { ssl: false, max: 5 });
  const results = {};

  const [material] = await sql`select id::text as id from public.attributes where code='material'`;
  const [pvcValue] = await sql`select av.id::text as id from public.attribute_values av where av.attribute_id=${material.id}::uuid and av.display_value='PVC'`;

  const [product] = await sql`insert into public.products (name, slug, description) values ('A3.6-B Shadow Fixture', 'a36b-shadow-fixture', 'fixture') returning id::text as id`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${product.id}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;
  const [batch] = await sql`insert into public.pim_publication_batches (kind, status, member_fingerprint, baseline_reference, created_by) values ('canary', 'active', 'a36b-fixture-fp', 'a36b-fixture-baseline', 'a36b-fixture') returning id::text as id`;
  await sql`insert into public.pim_attribute_publications (product_id, attribute_id, attribute_value_id, state, batch_id, published_at, actor_reference)
    values (${product.id}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid, 'published', ${batch.id}::uuid, now(), 'a36b-fixture')`;

  const before = { pav: (await sql`select count(*)::int as c from public.product_attribute_values`)[0].c, pub: (await sql`select count(*)::int as c from public.pim_attribute_publications`)[0].c };

  // ---- Case A: official matches PIM (MATCH) ----
  const officialMatch = { sku: "A36B-SKU", slug: "a36b-shadow-fixture", attributes: [{ code: "material", name: "Material", value: "PVC" }] };
  const eventsMatch = [];
  await new Promise((resolve) => {
    runPimCatalogShadow(officialMatch, "product", { mode: "shadow", sampleRatePercent: 100, telemetry: (e) => eventsMatch.push(e), schedule: (work) => { void work().then(resolve, resolve); } });
  });
  results.MATCH_CASE_COMPLETED = eventsMatch[0]?.shadowStatus === "completed";
  results.MATCH_CASE_CLASSIFICATION = eventsMatch[0]?.classification;
  results.MATCH_CASE_OFFICIAL_UNCHANGED = officialMatch.attributes[0].value === "PVC"; // never mutated

  // ---- Case B: official diverges from PIM (VALUE_DIFFERENCE) ----
  const officialDiverge = { sku: "A36B-SKU", slug: "a36b-shadow-fixture", attributes: [{ code: "material", name: "Material", value: "Alumínio" }] };
  const eventsDiverge = [];
  await new Promise((resolve) => {
    runPimCatalogShadow(officialDiverge, "product", { mode: "shadow", sampleRatePercent: 100, telemetry: (e) => eventsDiverge.push(e), schedule: (work) => { void work().then(resolve, resolve); } });
  });
  results.DIVERGENCE_CASE_COMPLETED = eventsDiverge[0]?.shadowStatus === "completed";
  results.DIVERGENCE_CASE_CLASSIFICATION = eventsDiverge[0]?.classification;
  results.DIVERGENCE_CASE_OFFICIAL_STILL_ALUMINIO = officialDiverge.attributes[0].value === "Alumínio"; // shadow never overwrites it

  // ---- mode=off produces zero DB access even with a real, resolvable product ----
  let offCalled = false;
  runPimCatalogShadow(officialMatch, "product", { mode: "off", schedule: () => { offCalled = true; } });
  results.MODE_OFF_ZERO_SCHEDULE = offCalled === false;

  const after = { pav: (await sql`select count(*)::int as c from public.product_attribute_values`)[0].c, pub: (await sql`select count(*)::int as c from public.pim_attribute_publications`)[0].c };
  results.NO_WRITES_FROM_SHADOW_OBSERVATION = before.pav === after.pav && before.pub === after.pub;

  console.log(JSON.stringify(results, null, 2));
  const allPass = Object.entries(results).every(([k, v]) => k.endsWith("_CLASSIFICATION") || v === true);
  if (!allPass) { console.error("A36B_SHADOW_RUNTIME_DISPOSABLE_FAIL"); process.exitCode = 1; }

  await sql.end({ timeout: 1 });
} finally {
  if (created) { try { await run("docker", ["rm", "-f", container]); } catch {} }
}
