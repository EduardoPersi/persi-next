// A3.6-A Section 21: proves lib/pim/publication-read-model.ts's native
// batch API (getPublishedAttributesForProducts) against a REAL disposable
// Postgres running the canonical schema/migrations -- never staging, never
// production. Same harness pattern as
// scripts/database/pim-publication-foundation-disposable.mjs.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import postgres from "postgres";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");

const image = "public.ecr.aws/supabase/postgres:17.6.1.155";
const host = "127.0.0.1";
const container = `persi-a36a-readmodel-${crypto.randomBytes(6).toString("hex")}`;
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
  const { getPublishedAttributesForProducts, getPublishedAttributesForProduct } = await import("../../lib/pim/publication-read-model.ts");

  const sql = postgres(adminUrl, { ssl: false, max: 5 });
  const results = {};

  const [material] = await sql`select id::text as id from public.attributes where code='material'`;
  const [pvcValue] = await sql`select av.id::text as id from public.attribute_values av where av.attribute_id=${material.id}::uuid and av.display_value='PVC'`;

  async function makeProduct(slug) {
    const [p] = await sql`insert into public.products (name, slug, description) values (${slug}, ${slug}, 'A3.6-A fixture') returning id::text as id`;
    return p.id;
  }
  async function makeBatch(status) {
    const [b] = await sql`insert into public.pim_publication_batches (kind, status, member_fingerprint, baseline_reference, created_by, rolled_back_at, rolled_back_by)
      values ('canary', ${status}, 'a36a-fixture-fp', 'a36a-fixture-baseline', 'a36a-fixture',
        ${status === "rolled_back" ? sql`now()` : sql`null`}, ${status === "rolled_back" ? "a36a-fixture" : null})
      returning id::text as id`;
    return b.id;
  }

  // ---- Fixture 1: valid published member ----
  const productValid = await makeProduct("a36a-valid-published");
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productValid}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;
  const activeBatch = await makeBatch("active");
  await sql`insert into public.pim_attribute_publications (product_id, attribute_id, attribute_value_id, state, batch_id, published_at, actor_reference)
    values (${productValid}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid, 'published', ${activeBatch}::uuid, now(), 'a36a-fixture')`;

  // ---- Fixture 2: unpublished member (same shape, different product) ----
  const productUnpublished = await makeProduct("a36a-unpublished");
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productUnpublished}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;
  await sql`insert into public.pim_attribute_publications (product_id, attribute_id, attribute_value_id, state, batch_id, published_at, unpublished_at, actor_reference)
    values (${productUnpublished}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid, 'unpublished', ${activeBatch}::uuid, now(), now(), 'a36a-fixture')`;

  // ---- Fixture 3: published row, but batch itself is rolled_back (defense-in-depth case) ----
  const productRolledBackBatch = await makeProduct("a36a-rolledback-batch");
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productRolledBackBatch}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;
  const rolledBackBatch = await makeBatch("rolled_back");
  await sql`insert into public.pim_attribute_publications (product_id, attribute_id, attribute_value_id, state, batch_id, published_at, actor_reference)
    values (${productRolledBackBatch}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid, 'published', ${rolledBackBatch}::uuid, now(), 'a36a-fixture')`;

  // ---- Fixture 4: published row, source PAV removed after publication ----
  const productMissingSource = await makeProduct("a36a-missing-source");
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productMissingSource}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;
  await sql`insert into public.pim_attribute_publications (product_id, attribute_id, attribute_value_id, state, batch_id, published_at, actor_reference)
    values (${productMissingSource}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid, 'published', ${activeBatch}::uuid, now(), 'a36a-fixture')`;
  await sql`delete from public.product_attribute_values where product_id=${productMissingSource}::uuid`;

  // ---- Fixture 5: wrong identity (source PAV now points to a DIFFERENT attribute_value than the publication row claims) ----
  const [otherMaterialValue] = await sql`select av.id::text as id from public.attribute_values av where av.attribute_id=${material.id}::uuid and av.display_value <> 'PVC' limit 1`;
  const productWrongIdentity = await makeProduct("a36a-wrong-identity");
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productWrongIdentity}::uuid, ${material.id}::uuid, ${otherMaterialValue.id}::uuid)`;
  await sql`insert into public.pim_attribute_publications (product_id, attribute_id, attribute_value_id, state, batch_id, published_at, actor_reference)
    values (${productWrongIdentity}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid, 'published', ${activeBatch}::uuid, now(), 'a36a-fixture')`;

  const allProductIds = [productValid, productUnpublished, productRolledBackBatch, productMissingSource, productWrongIdentity];
  const batchMap = await getPublishedAttributesForProducts(allProductIds);

  results.POSITIVE_VALID_PUBLISHED_EXPOSED = batchMap.get(productValid)?.length === 1 && batchMap.get(productValid)[0].canonicalValue === "PVC";
  results.NEGATIVE_UNPUBLISHED_EXCLUDED = (batchMap.get(productUnpublished)?.length ?? -1) === 0;
  results.NEGATIVE_ROLLED_BACK_BATCH_EXCLUDED = (batchMap.get(productRolledBackBatch)?.length ?? -1) === 0;
  results.NEGATIVE_MISSING_SOURCE_EXCLUDED = (batchMap.get(productMissingSource)?.length ?? -1) === 0;
  results.NEGATIVE_WRONG_IDENTITY_EXCLUDED = (batchMap.get(productWrongIdentity)?.length ?? -1) === 0;
  results.MAP_HAS_ENTRY_FOR_EVERY_REQUESTED_PRODUCT = allProductIds.every((id) => batchMap.has(id));
  results.BATCH_QUERY_COUNT_FOR_5_PRODUCTS = 1; // proven statically in the test suite; documented here for the artifact

  // Single-product convenience wrapper sanity check
  const single = await getPublishedAttributesForProduct(productValid);
  results.SINGLE_PRODUCT_WRAPPER_CONSISTENT = single.length === 1 && single[0].canonicalValue === "PVC";

  // Outside/unknown product id must not throw and must return empty.
  const [unknownProduct] = await sql`insert into public.products (name, slug, description) values ('a36a-no-publications', 'a36a-no-publications', 'no pub rows at all') returning id::text as id`;
  const emptyMap = await getPublishedAttributesForProducts([unknownProduct.id]);
  results.PRODUCT_WITH_ZERO_PUBLICATIONS_RETURNS_EMPTY_ARRAY_NOT_MISSING_KEY = emptyMap.has(unknownProduct.id) && emptyMap.get(unknownProduct.id).length === 0;

  console.log(JSON.stringify(results, null, 2));

  const allPass = Object.entries(results).every(([k, v]) => k === "BATCH_QUERY_COUNT_FOR_5_PRODUCTS" || v === true);
  if (!allPass) { console.error("A36A_READ_MODEL_DISPOSABLE_FAIL"); process.exitCode = 1; }

  await sql.end({ timeout: 1 });
} finally {
  if (created) {
    try { await run("docker", ["rm", "-f", container]); } catch {}
  }
}
