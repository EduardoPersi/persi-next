// A3.7-A-R12: local, disposable-Postgres qualification of the MECHANISM
// added this round (scripts/database/pim-publication-canary-executor.mjs) --
// never staging, never production. Unlike the guard-layer unit tests
// (tests/pimA37AR12PublicationExecutorGuards.test.mjs), this script proves
// the executor's INTEGRATION with the REAL, already-qualified publication
// services (lib/pim/publication-service.ts) by importing and calling them
// directly against a throwaway container -- it does not reimplement
// eligibility, ownership, or rollback rules (those already have their own
// tests, e.g. tests/pimA35eP3APublicationFoundation.test.mjs).
//
// This uses a REPRESENTATIVE local test manifest (its own disposable-
// generated ids), NOT the real 0117/PVCB5M identities baked into the real
// executor -- those were separately verified read-only against real
// persi-staging in A3.7-A-R6B/R6C and are out of scope for a local
// container to reproduce. What this proves is the WIRING: that dry-run/
// prepare/publish/reconcile/rollback, driven exactly the way the real
// executor drives them, behave correctly end-to-end.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import postgres from "postgres";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");

const image = "public.ecr.aws/supabase/postgres:17.6.1.155";
const host = "127.0.0.1";
const container = `persi-r12-pubexec-${crypto.randomBytes(6).toString("hex")}`;
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
  // getDatabase() (lib/db/connection.ts) reads process.env.DATABASE_URL
  // LAZILY on first call and caches the connection -- setting it here, before
  // importing the real service module, makes the REAL publishBatch/
  // unpublishBatch/preparePublication/getPublicationState bind to this
  // disposable container, with zero code changes to those services.
  process.env.DATABASE_URL = adminUrl;

  const { preparePublication, publishBatch, unpublishBatch, getPublicationState, computeMemberFingerprint } = await import("../../lib/pim/publication-service.ts");
  const { CURRENT_PIM_BASELINE_SHA256 } = await import("../../lib/pim/publication-baseline.ts");

  const sql = postgres(adminUrl, { ssl: false, max: 5 });

  // ---- Fixture: 2 products, one supported attribute of each of the 3
  // relevant codes, shaped like the real 0117/PVCB5M pair but with its own
  // disposable ids (local test manifest, not the real staging identities). ----
  const [material] = await sql`select id::text as id from public.attributes where code='material'`;
  const [conexao] = await sql`select id::text as id from public.attributes where code='conexao'`;
  const [comprimento] = await sql`select id::text as id from public.attributes where code='comprimento'`;
  const [pvcValue] = await sql`select av.id::text as id from public.attribute_values av where av.attribute_id=${material.id}::uuid and av.display_value='PVC'`;
  const [roscavelValue] = await sql`select av.id::text as id from public.attribute_values av where av.attribute_id=${conexao.id}::uuid and av.display_value ilike 'roscável'`;
  const [comp6m] = await sql`insert into public.attribute_values (attribute_id, display_value, measurement_numerator, measurement_denominator, measurement_unit_id) select ${comprimento.id}::uuid,'6m',6,1,u.id from public.units u where u.code='m' limit 1 returning id::text as id`;
  const [comp5m] = await sql`insert into public.attribute_values (attribute_id, display_value, measurement_numerator, measurement_denominator, measurement_unit_id) select ${comprimento.id}::uuid,'5m',5,1,u.id from public.units u where u.code='m' limit 1 returning id::text as id`;

  const [productA] = await sql`insert into public.products (name, slug, description) values ('R12 Test Product A', 'r12-test-product-a', 'Fabricado em PVC roscável, 6m.') returning id::text as id`;
  const [productB] = await sql`insert into public.products (name, slug, description) values ('R12 Test Product B', 'r12-test-product-b', 'Fabricado em PVC, 5m.') returning id::text as id`;
  await sql`insert into public.product_variants (product_id, sku, status) values (${productA.id}::uuid, 'TEST-0117', 'active')`;
  await sql`insert into public.product_variants (product_id, sku, status) values (${productB.id}::uuid, 'TEST-PVCB5M', 'active')`;

  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productA.id}::uuid, ${comprimento.id}::uuid, ${comp6m.id}::uuid)`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productA.id}::uuid, ${conexao.id}::uuid, ${roscavelValue.id}::uuid)`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productA.id}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productB.id}::uuid, ${comprimento.id}::uuid, ${comp5m.id}::uuid)`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productB.id}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;

  const testManifest = [
    { productId: productA.id, attributeId: comprimento.id, attributeValueId: comp6m.id },
    { productId: productA.id, attributeId: conexao.id, attributeValueId: roscavelValue.id },
    { productId: productA.id, attributeId: material.id, attributeValueId: pvcValue.id },
    { productId: productB.id, attributeId: comprimento.id, attributeValueId: comp5m.id },
    { productId: productB.id, attributeId: material.id, attributeValueId: pvcValue.id },
  ];
  const actor = "r12-disposable-qualification@persi.local";

  // ---- 1. happy-path dry-run (preparePublication) 5/5 eligible ----
  const dryRun = await preparePublication(testManifest, CURRENT_PIM_BASELINE_SHA256);
  assert.equal(dryRun.length, 5);
  assert.ok(dryRun.every((r) => r.eligible === true), "all 5 must be eligible pre-publish");
  results["1_happy_path_dry_run_5_5"] = true;

  // ---- 6. NEEDS_REVIEW blocks eligibility ----
  const [productC] = await sql`insert into public.products (name, slug, description) values ('R12 Test Needs Review', 'r12-test-needs-review', 'x') returning id::text as id`;
  await sql`insert into public.product_variants (product_id, sku, status) values (${productC.id}::uuid, 'TEST-NR', 'active')`;
  const [aluValue] = await sql`insert into public.attribute_values (attribute_id, display_value, option_code) values (${material.id}::uuid,'R12 Aluminio NR','r12_aluminio_nr') returning id::text as id`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productC.id}::uuid, ${material.id}::uuid, ${aluValue.id}::uuid)`;
  await sql`insert into public.pim_attribute_reviews (product_id, attribute_id, attribute_value_id, source, status) values (${productC.id}::uuid, ${material.id}::uuid, ${aluValue.id}::uuid, 'manual', 'needs_review')`;
  const needsReviewCheck = await preparePublication([{ productId: productC.id, attributeId: material.id, attributeValueId: aluValue.id }], CURRENT_PIM_BASELINE_SHA256);
  assert.equal(needsReviewCheck[0].eligible, false);
  assert.ok(needsReviewCheck[0].reasonCodes.includes("NEEDS_REVIEW"), "must surface NEEDS_REVIEW via the REAL evaluatePublicationEligibility, not a reimplementation");
  results["6_needs_review_blocks_eligibility"] = true;

  // ---- 7. ineligible via open same-attribute conflict ----
  const [productD] = await sql`insert into public.products (name, slug, description) values ('R12 Test Conflict', 'r12-test-conflict', 'x') returning id::text as id`;
  await sql`insert into public.product_variants (product_id, sku, status) values (${productD.id}::uuid, 'TEST-CONFLICT', 'active')`;
  const [comp99m] = await sql`insert into public.attribute_values (attribute_id, display_value, measurement_numerator, measurement_denominator, measurement_unit_id) select ${comprimento.id}::uuid,'99m',99,1,u.id from public.units u where u.code='m' limit 1 returning id::text as id`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productD.id}::uuid, ${comprimento.id}::uuid, ${comp99m.id}::uuid)`;
  const fp1 = crypto.createHash("sha256").update("r12-fp1").digest("hex"), ef1 = crypto.createHash("sha256").update("r12-ef1").digest("hex");
  await sql`insert into public.pim_conflicts (product_id, attribute_key, conflict_type, status, source_fingerprint, evidence_fingerprint, detector_version, metadata) values (${productD.id}::uuid, 'length', 'unresolved_ambiguity', 'open', ${fp1}, ${ef1}, 'v1', '{}'::jsonb)`;
  const conflictCheck = await preparePublication([{ productId: productD.id, attributeId: comprimento.id, attributeValueId: comp99m.id }], CURRENT_PIM_BASELINE_SHA256);
  assert.equal(conflictCheck[0].eligible, false);
  assert.ok(conflictCheck[0].reasonCodes.includes("OPEN_CONFLICT_SAME_ATTRIBUTE"));
  results["7_ineligible_open_conflict"] = true;

  // ---- source invariance snapshot BEFORE publish ----
  const sourceBefore = await sql`select product_id::text, attribute_id::text, attribute_value_id::text from public.product_attribute_values where product_id in (${productA.id}::uuid, ${productB.id}::uuid) order by product_id, attribute_id`;
  const valuesBefore = await sql`select id::text, display_value from public.attribute_values where id in (${comp6m.id}::uuid, ${roscavelValue.id}::uuid, ${pvcValue.id}::uuid, ${comp5m.id}::uuid) order by id`;

  // ---- publish (happy path) ----
  const batchId = crypto.randomUUID();
  const fingerprint = computeMemberFingerprint(testManifest);
  const published = await publishBatch({ batchId, kind: "canary", members: testManifest, baselineReference: CURRENT_PIM_BASELINE_SHA256, reason: "R12 disposable qualification" }, actor);
  assert.equal(published.status, "active");
  assert.equal(published.publishedCount, 5);
  assert.equal(published.idempotentReplay, false);
  results["publish_happy_path"] = true;

  // ---- reconcile 5/5 published ----
  const state1 = await getPublicationState(batchId);
  assert.equal(state1.members.length, 5);
  assert.ok(state1.members.every((m) => m.state === "published"));
  results["reconcile_published_5_5"] = true;

  // ---- 8. cross-batch ownership: a second batch reusing one already-published identity must be rejected ----
  const otherBatchId = crypto.randomUUID();
  const overlapping = [testManifest[0], { productId: productC.id, attributeId: material.id, attributeValueId: aluValue.id }];
  // aluValue is needs_review, so this would ALSO fail eligibility first --
  // use a fresh, independently-eligible member instead so the ownership
  // guard specifically is what fires, not eligibility.
  const [productE] = await sql`insert into public.products (name, slug, description) values ('R12 Test Ownership', 'r12-test-ownership', 'x') returning id::text as id`;
  await sql`insert into public.product_variants (product_id, sku, status) values (${productE.id}::uuid, 'TEST-OWN', 'active')`;
  const [ownVal] = await sql`insert into public.attribute_values (attribute_id, display_value, option_code) values (${material.id}::uuid,'R12 Own Value','r12_own_value') returning id::text as id`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productE.id}::uuid, ${material.id}::uuid, ${ownVal.id}::uuid)`;
  const overlapMembers = [testManifest[0], { productId: productE.id, attributeId: material.id, attributeValueId: ownVal.id }];
  await assert.rejects(
    () => publishBatch({ batchId: otherBatchId, kind: "canary", members: overlapMembers, baselineReference: CURRENT_PIM_BASELINE_SHA256, reason: "should be rejected" }, actor),
    (error) => { assert.equal(error.code, "PIM_PUBLICATION_OWNED_BY_ANOTHER_BATCH"); return true; },
  );
  const otherBatchRow = await sql`select 1 from public.pim_publication_batches where id=${otherBatchId}::uuid`;
  assert.equal(otherBatchRow.length, 0, "the rejected batch must never have been created");
  results["8_cross_batch_ownership_rejected"] = true;

  // ---- 9. missing actor rejected ----
  await assert.rejects(() => publishBatch({ batchId: crypto.randomUUID(), kind: "canary", members: [{ productId: productE.id, attributeId: material.id, attributeValueId: ownVal.id }], baselineReference: CURRENT_PIM_BASELINE_SHA256 }, ""));
  results["9_missing_actor_rejected"] = true;

  // ---- 12. same-batch idempotent replay: no duplicate rows, no extra audit rows ----
  const auditCountBefore = (await sql`select count(*)::int as c from public.pim_audit_log where entity_type='attribute' and operation='ATTRIBUTE_PUBLISHED'`)[0].c;
  const replay = await publishBatch({ batchId, kind: "canary", members: testManifest, baselineReference: CURRENT_PIM_BASELINE_SHA256, reason: "replay" }, actor);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.publishedCount, 5);
  const auditCountAfter = (await sql`select count(*)::int as c from public.pim_audit_log where entity_type='attribute' and operation='ATTRIBUTE_PUBLISHED'`)[0].c;
  assert.equal(auditCountAfter, auditCountBefore, "idempotent replay must not write any new audit row");
  const dupCheck = await sql`select product_id, attribute_id, attribute_value_id, count(*)::int as c from public.pim_attribute_publications where batch_id=${batchId}::uuid group by 1,2,3 having count(*)>1`;
  assert.equal(dupCheck.length, 0, "no duplicate publication rows for any identity");
  results["12_idempotent_replay_no_duplicates"] = true;

  // ---- a second, disjoint batch, published to prove rollback scope is exact ----
  const secondBatchId = crypto.randomUUID();
  const secondMembers = [{ productId: productE.id, attributeId: material.id, attributeValueId: ownVal.id }];
  const secondPublished = await publishBatch({ batchId: secondBatchId, kind: "canary", members: secondMembers, baselineReference: CURRENT_PIM_BASELINE_SHA256, reason: "R12 disjoint batch" }, actor);
  assert.equal(secondPublished.status, "active");

  // ---- 13. rollback scope exact: unpublish the FIRST batch only ----
  const rollback = await unpublishBatch(batchId, actor, "R12 disposable rollback");
  assert.equal(rollback.status, "rolled_back");
  assert.equal(rollback.unpublishedCount, 5);
  const state2 = await getPublicationState(batchId);
  assert.ok(state2.members.every((m) => m.state === "unpublished"));
  const secondState = await getPublicationState(secondBatchId);
  assert.ok(secondState.members.every((m) => m.state === "published"), "rollback of batch 1 must never touch batch 2's rows");
  results["13_rollback_scope_exact"] = true;

  // ---- 14. source PIM values unchanged by publish+rollback ----
  const sourceAfter = await sql`select product_id::text, attribute_id::text, attribute_value_id::text from public.product_attribute_values where product_id in (${productA.id}::uuid, ${productB.id}::uuid) order by product_id, attribute_id`;
  const valuesAfter = await sql`select id::text, display_value from public.attribute_values where id in (${comp6m.id}::uuid, ${roscavelValue.id}::uuid, ${pvcValue.id}::uuid, ${comp5m.id}::uuid) order by id`;
  assert.deepEqual(sourceAfter, sourceBefore, "product_attribute_values must be byte-identical before/after publish+rollback");
  assert.deepEqual(valuesAfter, valuesBefore, "attribute_values must be byte-identical before/after publish+rollback");
  results["14_source_pim_invariance"] = true;

  // ---- rollback idempotent replay ----
  const rollbackReplay = await unpublishBatch(batchId, actor, "replay");
  assert.equal(rollbackReplay.idempotentReplay, true);
  assert.equal(rollbackReplay.unpublishedCount, 5);
  results["rollback_idempotent_replay"] = true;

  await sql.end({ timeout: 5 });
  console.log(JSON.stringify({ ok: true, fingerprintOfTestManifest: fingerprint, results }, null, 2));
} finally {
  if (created) {
    await run("docker", ["rm", "-f", container], { quiet: true }).catch(() => {});
  }
}
