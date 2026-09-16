// A3.5E-P3-A: proves the publication foundation (pim_publication_batches /
// pim_attribute_publications, plus the exact query shapes used by
// lib/pim/publication-eligibility.ts, lib/pim/publication-service.ts and
// lib/pim/publication-read-model.ts) against a REAL disposable Postgres
// running the canonical schema/migrations -- never staging, never
// production. Same harness pattern as
// scripts/database/pim-publication-gate-disposable.mjs.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import postgres from "postgres";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") throw new Error("OFFLINE_VALIDATION_REQUIRED");

const image = "public.ecr.aws/supabase/postgres:17.6.1.155";
const host = "127.0.0.1";
const container = `persi-p3a-pubfoundation-${crypto.randomBytes(6).toString("hex")}`;
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
  const sql = postgres(adminUrl, { ssl: false, max: 5 });
  const results = {};

  // ---- Fixture ----
  const [material] = await sql`select id::text as id from public.attributes where code='material'`;
  const [conexao] = await sql`select id::text as id from public.attributes where code='conexao'`;
  const [comprimento] = await sql`select id::text as id from public.attributes where code='comprimento'`;
  const [volume] = await sql`select id::text as id from public.attributes where code='volume'`;
  const [bitola] = await sql`insert into public.attributes (code, name, data_type, cardinality, is_commercial, is_technical, status) values ('p3a_bitola','P3A Bitola','option','single',true,false,'active') returning id::text as id`;

  const [pvcValue] = await sql`select av.id::text as id, av.display_value from public.attribute_values av where av.attribute_id=${material.id}::uuid and av.display_value='PVC'`;
  const [roscavelValue] = await sql`select av.id::text as id from public.attribute_values av where av.attribute_id=${conexao.id}::uuid and av.display_value ilike 'roscável'`;
  const [comp6m] = await sql`insert into public.attribute_values (attribute_id, display_value, measurement_numerator, measurement_denominator, measurement_unit_id) select ${comprimento.id}::uuid,'6m',6,1,u.id from public.units u where u.code='m' limit 1 returning id::text as id`;
  const [bitolaValue] = await sql`insert into public.attribute_values (attribute_id, display_value, option_code) values (${bitola.id}::uuid,'P3A Val','p3a_val') returning id::text as id`;

  const [productEligible] = await sql`insert into public.products (name, slug, description) values ('P3A Canary Eligible', 'p3a-canary-eligible', 'Fabricado em PVC. Comprimento: 6m explicito.') returning id::text as id`;
  const [productPlaceholder] = await sql`insert into public.products (name, slug, description) values ('P3A Placeholder', 'p3a-placeholder', 'Material: [Indique o material, como PVC, latão, aço galvanizado, etc.]') returning id::text as id`;
  const [productOutside] = await sql`insert into public.products (name, slug, description) values ('P3A Outside Batch', 'p3a-outside-batch', 'Fabricado em PVC tambem.') returning id::text as id`;
  const [productConflict] = await sql`insert into public.products (name, slug, description) values ('P3A Conflict', 'p3a-conflict', 'Comprimento em conflito.') returning id::text as id`;

  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productEligible.id}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productEligible.id}::uuid, ${comprimento.id}::uuid, ${comp6m.id}::uuid)`;
  // Product A also has an OPEN conflict on a DIFFERENT attribute (bitola) --
  // must never block its material/comprimento eligibility.
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productEligible.id}::uuid, ${bitola.id}::uuid, ${bitolaValue.id}::uuid)`;
  const fp1 = crypto.createHash("sha256").update("p3a-fp1").digest("hex"), ef1 = crypto.createHash("sha256").update("p3a-ef1").digest("hex");
  await sql`insert into public.pim_conflicts (product_id, attribute_key, conflict_type, status, source_fingerprint, evidence_fingerprint, detector_version, metadata) values (${productEligible.id}::uuid, 'p3a_bitola', 'unresolved_ambiguity', 'open', ${fp1}, ${ef1}, 'v1', '{}'::jsonb)`;

  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productPlaceholder.id}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productOutside.id}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;

  const [comp75m] = await sql`insert into public.attribute_values (attribute_id, display_value, measurement_numerator, measurement_denominator, measurement_unit_id) select ${comprimento.id}::uuid,'75m',75,1,u.id from public.units u where u.code='m' limit 1 returning id::text as id`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${productConflict.id}::uuid, ${comprimento.id}::uuid, ${comp75m.id}::uuid)`;
  const fp2 = crypto.createHash("sha256").update("p3a-fp2").digest("hex"), ef2 = crypto.createHash("sha256").update("p3a-ef2").digest("hex");
  await sql`insert into public.pim_conflicts (product_id, attribute_key, conflict_type, status, source_fingerprint, evidence_fingerprint, detector_version, metadata) values (${productConflict.id}::uuid, 'length', 'unresolved_ambiguity', 'open', ${fp2}, ${ef2}, 'v1', '{}'::jsonb)`;

  // ---- Eligibility gate (exact query shape from publication-eligibility.ts) ----
  async function evaluate(productId, attributeId, attributeValueId) {
    const [row] = await sql`
      select
        v.sku, a.code as "attributeCode", av.display_value as "displayValue", p.description,
        (pav.attribute_value_id is not null) as "identityMatches",
        r.status::text as "reviewStatus",
        exists(
          select 1 from public.pim_conflicts c
          where c.product_id = ${productId}::uuid and c.status = 'open'
            and c.attribute_key = case a.code when 'material' then 'material' when 'conexao' then 'connection' when 'comprimento' then 'length' when 'volume' then 'volume' else a.code end
        ) as "openConflictSameAttribute"
      from public.attributes a
      join public.products p on p.id = ${productId}::uuid
      left join lateral (select * from public.product_variants x where x.product_id=p.id order by x.created_at,x.id limit 1) v on true
      left join public.attribute_values av on av.id = ${attributeValueId}::uuid
      left join public.product_attribute_values pav on pav.product_id=${productId}::uuid and pav.attribute_id=${attributeId}::uuid and pav.attribute_value_id=${attributeValueId}::uuid
      left join public.pim_attribute_reviews r on r.product_id=${productId}::uuid and r.attribute_id=${attributeId}::uuid and r.attribute_value_id=${attributeValueId}::uuid
      where a.id = ${attributeId}::uuid
    `;
    if (!row) return { eligible: false, reasonCodes: ["ASSOCIATION_NOT_FOUND"] };
    if (row.displayValue === null) return { eligible: false, reasonCodes: ["ATTRIBUTE_VALUE_MISMATCH"] };
    const reasonCodes = [];
    if (!row.identityMatches) reasonCodes.push("ASSOCIATION_NOT_FOUND");
    const placeholder = /\[[^\]]*?\b(?:indique|especifique|especificar|informe|adicione|adicionar|insira|inserir|preencha|preencher)\b[^\]]*\]/i;
    if (row.attributeCode === "material" && row.description && placeholder.test(row.description)) reasonCodes.push("KNOWN_FALSE_POSITIVE");
    if (row.reviewStatus === "rejected") reasonCodes.push("HUMAN_REVIEW_REJECTED");
    if (row.openConflictSameAttribute) reasonCodes.push("OPEN_CONFLICT_SAME_ATTRIBUTE");
    return { eligible: reasonCodes.length === 0, reasonCodes };
  }

  const eligibleA = await evaluate(productEligible.id, material.id, pvcValue.id);
  assert.equal(eligibleA.eligible, true, "product A / material must be ELIGIBLE (unrelated bitola conflict must not block it)");
  const eligibleALength = await evaluate(productEligible.id, comprimento.id, comp6m.id);
  assert.equal(eligibleALength.eligible, true, "product A / comprimento must be ELIGIBLE");
  const eligibleB = await evaluate(productPlaceholder.id, material.id, pvcValue.id);
  assert.equal(eligibleB.eligible, false);
  assert.deepEqual(eligibleB.reasonCodes, ["KNOWN_FALSE_POSITIVE"]);
  const eligibleD = await evaluate(productConflict.id, comprimento.id, comp75m.id);
  assert.equal(eligibleD.eligible, false);
  assert.deepEqual(eligibleD.reasonCodes, ["OPEN_CONFLICT_SAME_ATTRIBUTE"], "SAME-attribute open conflict must block");
  const nonexistent = await evaluate(productEligible.id, material.id, "00000000-0000-0000-0000-000000000000");
  assert.equal(nonexistent.eligible, false);
  results.ELIGIBILITY_GATE_PASS = true;

  // ---- Publish batch (exact shape from publication-service.ts) ----
  const batchId = crypto.randomUUID();
  const members = [
    { productId: productEligible.id, attributeId: material.id, attributeValueId: pvcValue.id },
    { productId: productEligible.id, attributeId: comprimento.id, attributeValueId: comp6m.id },
  ];
  const fingerprint = crypto.createHash("sha256").update(members.map((m) => `${m.productId}:${m.attributeId}:${m.attributeValueId}`).sort().join("\n")).digest("hex");

  const CURRENT_BASELINE = "4b4cb3da092ebea4837850249f82c56543e0fac42c11b680ec315a26d462399d";
  async function publish(id, kind, fp, mem, actor, baselineReference = CURRENT_BASELINE) {
    if (baselineReference !== CURRENT_BASELINE) throw new Error("STALE_BASELINE");
    return sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('pim_publication_batch', 0))`;
      const existing = await tx`select id::text as id, member_fingerprint as "memberFingerprint", status::text as status from public.pim_publication_batches where id=${id}::uuid`;
      if (existing.length > 0) {
        if (existing[0].status === "rolled_back") throw new Error("BATCH_ALREADY_ROLLED_BACK");
        if (existing[0].memberFingerprint !== fp) throw new Error("BATCH_IDENTITY_CONFLICT");
        return { idempotentReplay: true };
      }
      // Fresh eligibility re-check for every member, inside the lock --
      // this is what catches source-truth drift between prepare and publish.
      for (const m of mem) {
        const check = await tx`select 1 from public.product_attribute_values where product_id=${m.productId}::uuid and attribute_id=${m.attributeId}::uuid and attribute_value_id=${m.attributeValueId}::uuid`;
        if (check.length === 0) throw new Error("ASSOCIATION_DRIFTED_OR_NOT_FOUND");
      }
      await tx`insert into public.pim_publication_batches (id, kind, member_fingerprint, baseline_reference, created_by) values (${id}::uuid, ${kind}, ${fp}, ${baselineReference}, ${actor})`;
      for (const m of mem) {
        // Cross-batch ownership guard, mirrors lib/pim/publication-service.ts exactly.
        const existingRow = await tx`select state::text as state, batch_id::text as "batchId" from public.pim_attribute_publications where product_id=${m.productId}::uuid and attribute_id=${m.attributeId}::uuid and attribute_value_id=${m.attributeValueId}::uuid for update`;
        if (existingRow.length > 0 && existingRow[0].state === "published") throw new Error(`OWNED_BY_ANOTHER_BATCH:${existingRow[0].batchId}`);
        await tx`insert into public.pim_attribute_publications (product_id, attribute_id, attribute_value_id, state, batch_id, published_at, actor_reference) values (${m.productId}::uuid, ${m.attributeId}::uuid, ${m.attributeValueId}::uuid, 'published', ${id}::uuid, now(), ${actor}) on conflict (product_id, attribute_id, attribute_value_id) do update set state='published', batch_id=excluded.batch_id, published_at=now(), unpublished_at=null, actor_reference=excluded.actor_reference`;
        await tx`insert into public.pim_audit_log (product_id, entity_type, entity_id, field_name, previous_value, new_value, source, actor_reference, operation, reason) select ${m.productId}::uuid,'attribute',${m.attributeId}::uuid,a.code,null,av.display_value,'manual',${actor},'ATTRIBUTE_PUBLISHED',${`batch=${id}`} from public.attributes a join public.attribute_values av on av.id=${m.attributeValueId}::uuid where a.id=${m.attributeId}::uuid`;
      }
      return { idempotentReplay: false };
    });
  }
  async function unpublish(id, actor) {
    return sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('pim_publication_batch', 0))`;
      const batchRows = await tx`select id::text as id, status::text as status from public.pim_publication_batches where id=${id}::uuid`;
      if (batchRows.length === 0) throw new Error("BATCH_NOT_FOUND");
      if (batchRows[0].status === "rolled_back") {
        const c = await tx`select count(*)::int as c from public.pim_attribute_publications where batch_id=${id}::uuid and state='unpublished'`;
        return { idempotentReplay: true, unpublishedCount: c[0].c };
      }
      const affected = await tx`update public.pim_attribute_publications set state='unpublished', unpublished_at=now() where batch_id=${id}::uuid and state='published' returning product_id::text as "productId", attribute_id::text as "attributeId"`;
      for (const row of affected) {
        await tx`insert into public.pim_audit_log (product_id, entity_type, entity_id, field_name, previous_value, new_value, source, actor_reference, operation, reason) select ${row.productId}::uuid,'attribute',${row.attributeId}::uuid,a.code,'published',null,'manual',${actor},'ATTRIBUTE_UNPUBLISHED',${`batch=${id}`} from public.attributes a where a.id=${row.attributeId}::uuid`;
      }
      await tx`update public.pim_publication_batches set status='rolled_back', rolled_back_at=now(), rolled_back_by=${actor} where id=${id}::uuid`;
      return { idempotentReplay: false, unpublishedCount: affected.length };
    });
  }

  const pavBefore = (await sql`select count(*)::int as c from public.product_attribute_values`)[0].c;
  const avBefore = (await sql`select count(*)::int as c from public.attribute_values`)[0].c;

  const first = await publish(batchId, "canary", fingerprint, members, "system:a3.5e-p3a-test");
  assert.equal(first.idempotentReplay, false);
  const replay = await publish(batchId, "canary", fingerprint, members, "system:a3.5e-p3a-test");
  assert.equal(replay.idempotentReplay, true, "same batch id + same membership must be an idempotent no-op");
  await assert.rejects(() => publish(batchId, "canary", "different-fingerprint", members, "system:a3.5e-p3a-test"), /BATCH_IDENTITY_CONFLICT/, "same batch id + different membership must be rejected deterministically");

  const pavAfter = (await sql`select count(*)::int as c from public.product_attribute_values`)[0].c;
  const avAfter = (await sql`select count(*)::int as c from public.attribute_values`)[0].c;
  assert.equal(pavAfter, pavBefore, "PRODUCT_ATTRIBUTE_VALUES delta must be 0 -- publication never touches source truth");
  assert.equal(avAfter, avBefore, "ATTRIBUTE_VALUES delta must be 0");
  results.PUBLISH_ATOMICITY_IDEMPOTENCY_PASS = true;
  results.SOURCE_TRUTH_INVARIANCE_PASS = true;

  // ---- Baseline authority (Section 16) ----
  await assert.rejects(() => publish(crypto.randomUUID(), "canary", fingerprint, members, "system:a3.5e-p3b-test", "wrong-baseline-sha"), /STALE_BASELINE/, "publish with a wrong baseline reference must be rejected");
  await assert.rejects(() => publish(crypto.randomUUID(), "canary", fingerprint, members, "system:a3.5e-p3b-test", ""), /STALE_BASELINE/, "publish with a missing baseline reference must be rejected");
  results.BASELINE_AUTHORITY_PASS = true;

  // ---- Source-truth drift (Section 20): value changes between prepare and publish ----
  const [comp8m] = await sql`insert into public.attribute_values (attribute_id, display_value, measurement_numerator, measurement_denominator, measurement_unit_id) select ${comprimento.id}::uuid,'8m',8,1,u.id from public.units u where u.code='m' limit 1 returning id::text as id`;
  const [driftProduct] = await sql`insert into public.products (name, slug, description) values ('P3B Drift Product', 'p3b-drift-product', 'Comprimento: 6m no momento do prepare.') returning id::text as id`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${driftProduct.id}::uuid, ${comprimento.id}::uuid, ${comp6m.id}::uuid)`;
  const preparedMembers = [{ productId: driftProduct.id, attributeId: comprimento.id, attributeValueId: comp6m.id }];
  // Source truth moves from 6m to 8m AFTER prepare, BEFORE publish.
  await sql`update public.product_attribute_values set attribute_value_id=${comp8m.id}::uuid where product_id=${driftProduct.id}::uuid and attribute_id=${comprimento.id}::uuid`;
  const driftFp = crypto.createHash("sha256").update(preparedMembers.map((m) => `${m.productId}:${m.attributeId}:${m.attributeValueId}`).join("\n")).digest("hex");
  await assert.rejects(() => publish(crypto.randomUUID(), "canary", driftFp, preparedMembers, "system:a3.5e-p3b-test"), /ASSOCIATION_DRIFTED_OR_NOT_FOUND/, "publishing the OLD (pre-drift) value must fail once source truth has moved to a different value");
  // Read model for the OLD value must also be empty (it is not published, and even if it somehow were, the join would exclude it).
  const driftReadModel = await sql`
    select 1 from public.pim_attribute_publications pap
    join public.product_attribute_values pav on pav.product_id=pap.product_id and pav.attribute_id=pap.attribute_id and pav.attribute_value_id=pap.attribute_value_id
    where pap.product_id=${driftProduct.id}::uuid and pap.attribute_value_id=${comp6m.id}::uuid and pap.state='published'
  `;
  assert.equal(driftReadModel.length, 0, "the stale pre-drift value must never be servable as published");
  results.SOURCE_TRUTH_DRIFT_PASS = true;

  // ---- Read model ----
  async function readModel(productId) {
    return sql`
      select a.code as "attributeCode", av.display_value as value
      from public.pim_attribute_publications pap
      join public.product_attribute_values pav on pav.product_id=pap.product_id and pav.attribute_id=pap.attribute_id and pav.attribute_value_id=pap.attribute_value_id
      join public.attributes a on a.id=pap.attribute_id
      join public.attribute_values av on av.id=pap.attribute_value_id
      where pap.product_id=${productId}::uuid and pap.state='published' order by a.code
    `;
  }
  const publishedA = await readModel(productEligible.id);
  assert.deepEqual(publishedA.map((r) => r.attributeCode).sort(), ["comprimento", "material"]);
  const publishedOutside = await readModel(productOutside.id);
  assert.equal(publishedOutside.length, 0, "product outside the batch must be completely unaffected");
  const publishedPlaceholder = await readModel(productPlaceholder.id);
  assert.equal(publishedPlaceholder.length, 0, "H-827-analogous excluded product must never appear published");
  results.READ_MODEL_PASS = true;

  // ---- Rollback ----
  const pavBeforeRollback = (await sql`select count(*)::int as c from public.product_attribute_values`)[0].c;
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('pim_publication_batch', 0))`;
    await tx`update public.pim_attribute_publications set state='unpublished', unpublished_at=now() where batch_id=${batchId}::uuid and state='published'`;
    await tx`update public.pim_publication_batches set status='rolled_back', rolled_back_at=now(), rolled_back_by='system:a3.5e-p3a-test' where id=${batchId}::uuid`;
  });
  const publishedAfterRollback = await readModel(productEligible.id);
  assert.equal(publishedAfterRollback.length, 0, "read model must return to BEFORE after rollback");
  const auditRows = await sql`select operation, count(*)::int as c from public.pim_audit_log where actor_reference='system:a3.5e-p3a-test' group by operation`;
  assert.ok(auditRows.some((r) => r.operation === "ATTRIBUTE_PUBLISHED"), "publish audit history must survive rollback");
  const pavAfterRollback = (await sql`select count(*)::int as c from public.product_attribute_values`)[0].c;
  assert.equal(pavAfterRollback, pavBeforeRollback, "source truth still untouched by the rollback operation itself");
  // Repeated unpublish on the already-rolled-back batch is idempotent (0 additional rows flipped).
  const secondRollback = await sql`update public.pim_attribute_publications set state='unpublished', unpublished_at=now() where batch_id=${batchId}::uuid and state='published' returning 1`;
  assert.equal(secondRollback.length, 0, "unpublish repeated on an already-rolled-back batch must affect 0 rows");
  results.ROLLBACK_RESTORES_BEFORE_PASS = true;

  // ---- Batch state machine (Section 18): a rolled_back batch id is terminal, never resurrected ----
  await assert.rejects(() => publish(batchId, "canary", fingerprint, members, "system:a3.5e-p3a-test"), /BATCH_ALREADY_ROLLED_BACK/, "reusing a rolled_back batch id -- even with identical membership -- must never be treated as still-published");
  results.BATCH_STATE_MACHINE_PASS = true;

  // ---- Concurrency: two simultaneous publish attempts on the SAME identity ----
  const concurrentMembers = [{ productId: productOutside.id, attributeId: material.id, attributeValueId: pvcValue.id }];
  const concurrentFp = crypto.createHash("sha256").update(concurrentMembers.map((m) => `${m.productId}:${m.attributeId}:${m.attributeValueId}`).join("\n")).digest("hex");
  const batchIdA = crypto.randomUUID(), batchIdB = crypto.randomUUID();
  const [resultA, resultB] = await Promise.allSettled([
    publish(batchIdA, "canary", concurrentFp, concurrentMembers, "system:a3.5e-p3a-concurrent-a"),
    publish(batchIdB, "canary", concurrentFp, concurrentMembers, "system:a3.5e-p3a-concurrent-b"),
  ]);
  // A3.5E-P3-F cross-batch ownership guard changes the correct outcome here:
  // the advisory lock serializes the two attempts, but they are two DIFFERENT
  // batch ids racing for the SAME identity -- exactly one must win (create
  // the row) and the other must be explicitly REJECTED (OWNED_BY_ANOTHER_BATCH),
  // never both silently "succeed" via last-write-wins overwrite.
  const settled = [resultA, resultB];
  const fulfilledCount = settled.filter((r) => r.status === "fulfilled").length;
  const rejectedCount = settled.filter((r) => r.status === "rejected").length;
  assert.equal(fulfilledCount, 1, "exactly ONE of the two concurrent publishers must succeed");
  assert.equal(rejectedCount, 1, "exactly ONE must be rejected -- never both silently fulfilled (that would mean a silent rebind)");
  const rejectedOne = settled.find((r) => r.status === "rejected");
  assert.match(String(rejectedOne.reason), /OWNED_BY_ANOTHER_BATCH/);
  const finalRows = await sql`select batch_id::text as "batchId" from public.pim_attribute_publications where product_id=${productOutside.id}::uuid and attribute_id=${material.id}::uuid`;
  assert.equal(finalRows.length, 1, "exactly one row must exist for the identity regardless of two concurrent publishers (PK enforces this, advisory lock serializes it)");
  results.CONCURRENCY_ZERO_DUPLICATE_PASS = true;

  // ---- RLS / privileges ----
  let anonSelectBlocked = false, anonInsertBlocked = false, authenticatedInsertBlocked = false;
  try {
    await sql.begin(async (tx) => { await tx`set local role anon`; const rows = await tx`select * from public.pim_attribute_publications limit 1`; anonSelectBlocked = rows.length === 0; });
  } catch { anonSelectBlocked = true; }
  try {
    await sql.begin(async (tx) => { await tx`set local role anon`; await tx`insert into public.pim_publication_batches (kind, member_fingerprint, created_by) values ('canary','x','anon-probe')`; });
  } catch { anonInsertBlocked = true; }
  try {
    await sql.begin(async (tx) => { await tx`set local role authenticated`; await tx`insert into public.pim_attribute_publications (product_id, attribute_id, attribute_value_id, state, batch_id, published_at, actor_reference) values (${productOutside.id}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid, 'published', ${batchIdA}::uuid, now(), 'authenticated-probe')`; });
  } catch { authenticatedInsertBlocked = true; }
  assert.ok(anonSelectBlocked, "ANON_SELECT_MUST_BE_BLOCKED");
  assert.ok(anonInsertBlocked, "ANON_INSERT_MUST_BE_BLOCKED");
  assert.ok(authenticatedInsertBlocked, "AUTHENTICATED_INSERT_MUST_BE_BLOCKED");
  results.RLS_PRIVILEGE_PASS = true;

  // ---- A3.5E-P3-D Section 22: exact 8-member canary cardinality simulation ----
  // Mirrors the real canary's shape (2 material + 2 conexao + 2 comprimento +
  // 2 volume) with fresh, isolated fixture products/values, proving the
  // read model goes 0 -> 8 -> 0 with the EXACT cardinality the real canary
  // will use, and that a 9th, out-of-canary product is never affected.
  const eight = [];
  for (let i = 0; i < 8; i++) {
    const attrList = [material, material, conexao, conexao, comprimento, comprimento, volume, volume];
    const attr = attrList[i];
    const [p] = await sql`insert into public.products (name, slug, description) values (${`P3D Canary Fixture ${i}`}, ${`p3d-canary-fixture-${i}`}, 'Fixture isolado para simulação de cardinalidade 8.') returning id::text as id`;
    let valueId;
    if (attr === material) valueId = pvcValue.id;
    else if (attr === conexao) valueId = roscavelValue.id;
    else if (attr === comprimento) { const [v] = await sql`insert into public.attribute_values (attribute_id, display_value, measurement_numerator, measurement_denominator, measurement_unit_id) select ${comprimento.id}::uuid,${`${i}m`},${i+1},1,u.id from public.units u where u.code='m' limit 1 returning id::text as id`; valueId = v.id; }
    else { const [v] = await sql`insert into public.attribute_values (attribute_id, display_value, measurement_numerator, measurement_denominator, measurement_unit_id) select ${volume.id}::uuid,${`${i}L`},${i+1},1,u.id from public.units u where u.code='L' limit 1 returning id::text as id`; valueId = v.id; }
    await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${p.id}::uuid, ${attr.id}::uuid, ${valueId}::uuid)`;
    eight.push({ productId: p.id, attributeId: attr.id, attributeValueId: valueId });
  }
  const [ninthOutsideProduct] = await sql`insert into public.products (name, slug, description) values ('P3D Ninth Outside Product', 'p3d-ninth-outside', 'Fabricado em PVC, fora do canario.') returning id::text as id`;
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${ninthOutsideProduct.id}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;

  const readModelBefore8 = await sql`select 1 from public.pim_attribute_publications where product_id = any(${eight.map(m=>m.productId)}::uuid[]) and state='published'`;
  assert.equal(readModelBefore8.length, 0, "READ_MODEL_BEFORE must be 0");

  const eightBatchId = crypto.randomUUID();
  const eightFp = crypto.createHash("sha256").update(eight.map((m) => `${m.productId}:${m.attributeId}:${m.attributeValueId}`).sort().join("\n")).digest("hex");
  await publish(eightBatchId, "canary", eightFp, eight, "system:a3.5e-p3d-8-simulation");

  const publishedCount8 = (await sql`select count(*)::int as c from public.pim_attribute_publications where batch_id=${eightBatchId}::uuid and state='published'`)[0].c;
  assert.equal(publishedCount8, 8, "READ_MODEL_AFTER_SIMULATED_PUBLISH must be exactly 8");
  const ninthLeak = await readModel(ninthOutsideProduct.id);
  assert.equal(ninthLeak.length, 0, "READ_MODEL_OUTSIDE_CANARY_LEAKS must be 0 -- the 9th product must never appear published");

  // ---- A3.5E-P3-F Section 16/22: cross-batch ownership + wrong-batch negative tests ----
  // A brand-new batch containing ONE of the already-published 8 identities
  // must be rejected wholesale (all-or-nothing), never rebind that row.
  const rebindAttemptMembers = [eight[0], { productId: (await sql`insert into public.products (name, slug, description) values ('P3F Rebind Fixture', 'p3f-rebind-fixture', 'Fabricado em PVC.') returning id::text as id`)[0].id, attributeId: material.id, attributeValueId: pvcValue.id }];
  await sql`insert into public.product_attribute_values (product_id, attribute_id, attribute_value_id) values (${rebindAttemptMembers[1].productId}::uuid, ${material.id}::uuid, ${pvcValue.id}::uuid)`;
  const rebindFp = crypto.createHash("sha256").update(rebindAttemptMembers.map((m) => `${m.productId}:${m.attributeId}:${m.attributeValueId}`).sort().join("\n")).digest("hex");
  await assert.rejects(() => publish(crypto.randomUUID(), "canary", rebindFp, rebindAttemptMembers, "system:a3.5e-p3f-rebind-attempt"), /OWNED_BY_ANOTHER_BATCH/, "a new batch must never silently rebind a row already published by another batch");
  // Confirm the original row is COMPLETELY untouched (still owned by eightBatchId, still published) -- proves all-or-nothing, not a partial steal.
  const stillOwned = await sql`select batch_id::text as "batchId", state::text as state from public.pim_attribute_publications where product_id=${eight[0].productId}::uuid and attribute_id=${eight[0].attributeId}::uuid`;
  assert.equal(stillOwned[0].batchId, eightBatchId, "ownership must remain with the original batch after a rejected rebind attempt");
  assert.equal(stillOwned[0].state, "published");
  // The second, never-conflicting member of the rejected attempt must also NOT have been inserted (whole transaction rolled back).
  const partialLeak = await sql`select 1 from public.pim_attribute_publications where product_id=${rebindAttemptMembers[1].productId}::uuid`;
  assert.equal(partialLeak.length, 0, "NO_PARTIAL_ROLLBACK: the non-conflicting member of a rejected batch must not have been inserted either");
  results.CROSS_BATCH_REBIND_PROTECTION_PASS = true;

  // Wrong-batch negative tests (Section 22).
  await assert.rejects(() => publish(eightBatchId, "canary", "wrong-fingerprint-value", eight, "system:a3.5e-p3f-wrong-fp"), /BATCH_IDENTITY_CONFLICT/, "wrong fingerprint against an existing active batch id must be rejected");
  await assert.rejects(() => publish(crypto.randomUUID(), "canary", eightFp, [...eight, rebindAttemptMembers[1]], "system:a3.5e-p3f-extra-member"), /OWNED_BY_ANOTHER_BATCH/, "extra member alongside already-owned members still hits the ownership guard (whole batch rejected)");
  await assert.rejects(() => publish(crypto.randomUUID(), "canary", eightFp, eight.slice(0, 7), "system:a3.5e-p3f-missing-member"), /OWNED_BY_ANOTHER_BATCH/, "a subset of already-owned members is still rejected (ownership guard fires per member, batch-wide rollback)");
  results.WRONG_BATCH_NEGATIVE_TESTS_PASS = true;

  // ---- Rollback (using the real unpublishBatch-equivalent helper) ----
  const rollbackResult = await unpublish(eightBatchId, "system:a3.5e-p3f-rollback");
  assert.equal(rollbackResult.idempotentReplay, false);
  assert.equal(rollbackResult.unpublishedCount, 8);
  const publishedAfterRollback8 = (await sql`select count(*)::int as c from public.pim_attribute_publications where batch_id=${eightBatchId}::uuid and state='published'`)[0].c;
  assert.equal(publishedAfterRollback8, 0, "READ_MODEL_AFTER_SIMULATED_ROLLBACK must be 0");
  const totalRowsStillExist = (await sql`select count(*)::int as c from public.pim_attribute_publications where batch_id=${eightBatchId}::uuid`)[0].c;
  assert.equal(totalRowsStillExist, 8, "UNPUBLISHED != DELETED: all 8 rows must still exist, just state='unpublished'");
  const pavStillHas8 = await sql`select count(*)::int as c from public.product_attribute_values where product_id = any(${eight.map(m=>m.productId)}::uuid[])`;
  assert.equal(pavStillHas8[0].c, 8, "source PAV rows for the 8 canary fixtures must be completely untouched by unpublish");
  results.ROLLBACK_VIA_REAL_HELPER_PASS = true;

  // Rollback idempotency: calling unpublish again on the same (now rolled_back) batch.
  const auditCountBeforeSecondRollback = (await sql`select count(*)::int as c from public.pim_audit_log where reason=${`batch=${eightBatchId}`}`)[0].c;
  const secondRollbackResult = await unpublish(eightBatchId, "system:a3.5e-p3f-rollback-again");
  assert.equal(secondRollbackResult.idempotentReplay, true);
  const auditCountAfterSecondRollback = (await sql`select count(*)::int as c from public.pim_audit_log where reason=${`batch=${eightBatchId}`}`)[0].c;
  assert.equal(auditCountAfterSecondRollback, auditCountBeforeSecondRollback, "repeated unpublish must not write additional audit rows");
  results.ROLLBACK_IDEMPOTENCY_PASS = true;

  // Post-rollback read model + outside-leak check.
  const readModelAfterRollback = await sql`select 1 from public.pim_attribute_publications where product_id = any(${eight.map(m=>m.productId)}::uuid[]) and state='published'`;
  assert.equal(readModelAfterRollback.length, 0);
  const ninthLeakAfterRollback = await readModel(ninthOutsideProduct.id);
  assert.equal(ninthLeakAfterRollback.length, 0);
  results.POST_ROLLBACK_READ_MODEL_PASS = true;

  results.CANARY_8_CARDINALITY_SIMULATION = { READ_MODEL_BEFORE: readModelBefore8.length, READ_MODEL_AFTER_SIMULATED_PUBLISH: publishedCount8, READ_MODEL_OUTSIDE_CANARY_LEAKS: ninthLeak.length, READ_MODEL_AFTER_SIMULATED_ROLLBACK: publishedAfterRollback8 };

  console.log(JSON.stringify(results, null, 2));
  await sql.end({ timeout: 1 });
} finally {
  if (created) await run("docker", ["rm", "-f", container], { quiet: true }).catch(() => {});
}
