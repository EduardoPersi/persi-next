// A3.7-A-R17-R1: local, disposable-Postgres reproduction of the REAL
// resolveFichaTecnicaSpecifications() pipeline (Gates 1-8: slug resolution,
// active canary membership, published attribute read model, current
// eligibility, ID intersection, comparator, merge, output shape) using a
// fixture faithfully shaped like the REAL 0117 canary state (3 published
// associations: material/conexao/comprimento, batch kind='canary'
// status='active'). Only `isSafeToRun` is overridden (the disposable
// container can never match EXPECTED_STAGING_PROJECT_REF) -- every other
// dependency is the REAL, unmocked function. This isolates "does the
// pipeline logic work end-to-end against a correct DB state" from "did the
// real staging process actually receive mode=canary / a matching DB
// binding", which cannot be observed from this offline session.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import postgres from "postgres";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");

const image = "public.ecr.aws/supabase/postgres:17.6.1.155";
const host = "127.0.0.1";
const container = `persi-r17r1-repro-${crypto.randomBytes(6).toString("hex")}`;
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
const results = {};
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

  const { publishBatch } = await import("../../lib/pim/publication-service.ts");
  const { CURRENT_PIM_BASELINE_SHA256 } = await import("../../lib/pim/publication-baseline.ts");
  const { resolveFichaTecnicaSpecifications } = await import("../../services/catalog/productFichaTecnica.ts");
  const { getActiveCanaryMembership, getPublishedAttributesForProduct } = await import("../../lib/pim/publication-read-model.ts");

  const sql = postgres(adminUrl, { ssl: false, max: 5 });

  // ---- Fixture faithfully shaped like the REAL 0117 (own disposable ids,
  // not the real staging UUIDs -- those are out of scope for a local
  // container to reproduce, per the same convention as the R12 script). ----
  const [material] = await sql`select id::text as id from public.attributes where code='material'`;
  const [conexao] = await sql`select id::text as id from public.attributes where code='conexao'`;
  const [comprimento] = await sql`select id::text as id from public.attributes where code='comprimento'`;
  const [pvcValue] = await sql`select av.id::text as id from public.attribute_values av where av.attribute_id=${material.id}::uuid and av.display_value='PVC'`;
  const [roscavelValue] = await sql`select av.id::text as id from public.attribute_values av where av.attribute_id=${conexao.id}::uuid and av.display_value ilike 'roscável'`;
  const [comp6m] = await sql`insert into public.attribute_values (attribute_id, display_value, measurement_numerator, measurement_denominator, measurement_unit_id) select ${comprimento.id}::uuid,'6m',6,1,u.id from public.units u where u.code='m' limit 1 returning id::text as id`;

  const [product0117] = await sql`insert into public.products (name, slug, description) values ('Tubo PVC Branco Roscável 1/2 Krona 6m', 'tubo-pvc-branco-roscavel-1-2-krona-6m', 'Fabricado em PVC roscável, 6m.') returning id::text as id`;
  await sql`insert into public.product_variants (product_id, sku, status) values (${product0117.id}::uuid, '0117', 'active')`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${product0117.id}::uuid, ${comprimento.id}::uuid, ${comp6m.id}::uuid)`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${product0117.id}::uuid, ${conexao.id}::uuid, ${roscavelValue.id}::uuid)`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${product0117.id}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;

  const manifest = [
    { productId: product0117.id, attributeId: comprimento.id, attributeValueId: comp6m.id },
    { productId: product0117.id, attributeId: conexao.id, attributeValueId: roscavelValue.id },
    { productId: product0117.id, attributeId: material.id, attributeValueId: pvcValue.id },
  ];
  const batchId = crypto.randomUUID();
  const published = await publishBatch({ batchId, kind: "canary", members: manifest, baselineReference: CURRENT_PIM_BASELINE_SHA256, reason: "R17-R1 repro" }, "r17r1-repro@persi.local");
  assert.equal(published.status, "active");
  assert.equal(published.publishedCount, 3);
  results["publish_0117_shaped_fixture_3_3"] = true;

  // ---- Gate 2: active canary membership ----
  const membership = await getActiveCanaryMembership(product0117.id);
  results["gate2_membership_count"] = membership.length;
  assert.equal(membership.length, 3, "GATE 2 FAILED: expected 3 active canary membership rows");

  // ---- Gate 3: published attribute read model ----
  const publishedAttrs = await getPublishedAttributesForProduct(product0117.id);
  results["gate3_published_count"] = publishedAttrs.length;
  assert.equal(publishedAttrs.length, 3, "GATE 3 FAILED: expected 3 exposable published attribute rows");

  // ---- Full pipeline: resolveFichaTecnicaSpecifications with REAL deps
  // (only slug->id resolution needs a real DB row, which it has; only
  // isSafeToRun is overridden since the disposable container never matches
  // EXPECTED_STAGING_PROJECT_REF) ----
  const officialLikeWooProduct = {
    id: 117, slug: "tubo-pvc-branco-roscavel-1-2-krona-6m", type: "simple",
    name: "Tubo PVC Branco Roscável 1/2 Krona 6m", permalink: "https://x/tubo-pvc-branco-roscavel-1-2-krona-6m",
    sku: "0117", shortDescription: "", description: "", price: 10, currencyCode: "BRL", currencySymbol: "R$",
    currencyMinorUnit: 2, images: [], categories: [], brands: [], available: true, stockStatus: "instock",
    averageRating: 0, reviewCount: 0, featured: false, onSale: false, variations: [],
    attributes: [
      { id: 1, name: "Cor", taxonomy: "pa_cor", hasVariations: false, terms: [{ id: 1, name: "Branco", slug: "branco" }], options: [{ value: "branco", label: "Branco", slug: "branco" }] },
      { id: 2, name: "Marca", taxonomy: "pa_marca", hasVariations: false, terms: [{ id: 2, name: "Krona", slug: "krona" }], options: [{ value: "krona", label: "Krona", slug: "krona" }] },
    ],
  };

  const specifications = await resolveFichaTecnicaSpecifications(officialLikeWooProduct, { mode: "canary", isSafeToRun: () => true });
  results["full_pipeline_result"] = specifications;
  results["full_pipeline_addition_count"] = specifications ? specifications.length - 2 : null; // minus Cor/Marca baseline
  results["full_pipeline_returned_undefined"] = specifications === undefined;

  await sql.end({ timeout: 5 });
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  if (created) {
    await run("docker", ["rm", "-f", container], { quiet: true }).catch(() => {});
  }
}
