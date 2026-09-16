import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computeMemberFingerprint } from "../lib/pim/publication-service.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// ---------- computeMemberFingerprint: real runtime unit tests (pure function) ----------

test("computeMemberFingerprint: order-independent (same set, different array order -> same hash)", () => {
  const a = [
    { productId: "p1", attributeId: "a1", attributeValueId: "v1" },
    { productId: "p2", attributeId: "a2", attributeValueId: "v2" },
  ];
  const b = [a[1], a[0]];
  assert.equal(computeMemberFingerprint(a), computeMemberFingerprint(b));
});

test("computeMemberFingerprint: different membership -> different hash", () => {
  const a = [{ productId: "p1", attributeId: "a1", attributeValueId: "v1" }];
  const b = [{ productId: "p1", attributeId: "a1", attributeValueId: "v2" }];
  assert.notEqual(computeMemberFingerprint(a), computeMemberFingerprint(b));
});

test("computeMemberFingerprint: deterministic across repeated calls", () => {
  const members = [{ productId: "p1", attributeId: "a1", attributeValueId: "v1" }];
  assert.equal(computeMemberFingerprint(members), computeMemberFingerprint(members));
});

// ---------- migration: schema shape, forward-only, RLS ----------

test("migration: pim_publication_batches and pim_attribute_publications exist with the right identity/constraints", async () => {
  const migration = await read("supabase/migrations/20260915030000_pim_publication_foundation.sql");
  assert.match(migration, /create table public\.pim_publication_batches/);
  assert.match(migration, /create table public\.pim_attribute_publications/);
  assert.match(migration, /primary key \(product_id, attribute_id, attribute_value_id\)/);
  assert.match(migration, /references public\.products\(id\) on delete cascade/);
  assert.match(migration, /references public\.attributes\(id\) on delete restrict/);
  assert.match(migration, /references public\.attribute_values\(id\) on delete restrict/);
  assert.match(migration, /alter table public\.pim_publication_batches enable row level security/);
  assert.match(migration, /alter table public\.pim_attribute_publications enable row level security/);
  // Fail-closed by omission: no policy grants anon/authenticated any access.
  assert.doesNotMatch(migration, /create policy/);
  // No backfill, no data write of any kind in a schema migration.
  assert.doesNotMatch(migration, /^\s*insert into/im);
});

test("migration: batch rollback state is constrained (status<->timestamp coherence)", async () => {
  const migration = await read("supabase/migrations/20260915030000_pim_publication_foundation.sql");
  assert.match(migration, /pim_publication_batches_rollback_check/);
  assert.match(migration, /pim_attribute_publications_timestamp_check/);
});

test("existing migrations are not modified by this phase", async () => {
  const foundation = await read("supabase/migrations/20260827120000_pim_v1_foundation.sql");
  const decisionVersioning = await read("supabase/migrations/20260913150000_pim_attribute_decision_versioning.sql");
  assert.doesNotMatch(foundation, /pim_attribute_publications|pim_publication_batches/);
  assert.doesNotMatch(decisionVersioning, /pim_attribute_publications|pim_publication_batches/);
});

// ---------- eligibility gate: attribute-scoped conflict mapping, source shape ----------

test("eligibility: pim_conflicts.attribute_key mapping covers comprimento->length and conexao->connection (not a naive code match)", async () => {
  const source = await read("lib/pim/publication-eligibility.ts");
  assert.match(source, /comprimento:\s*"length"/);
  assert.match(source, /conexao:\s*"connection"/);
  assert.match(source, /material:\s*"material"/);
  assert.match(source, /volume:\s*"volume"/);
});

test("eligibility: conflict check is scoped to c.status = 'open' and the SAME attribute only", async () => {
  const source = await read("lib/pim/publication-eligibility.ts");
  assert.match(source, /c\.status = 'open'/);
  assert.match(source, /c\.attribute_key = case a\.code/);
});

test("eligibility: only material is checked against the placeholder false-positive pattern (scope confirmed in A3.5E-P2)", async () => {
  const source = await read("lib/pim/publication-eligibility.ts");
  assert.match(source, /row\.attributeCode === "material" && row\.description && TEMPLATE_PLACEHOLDER_PATTERN\.test/);
});

test("eligibility: read-only -- never writes", async () => {
  const source = await read("lib/pim/publication-eligibility.ts");
  assert.doesNotMatch(source, /insert into|update public\.|delete from/);
});

test("eligibility: ATTRIBUTE_NOT_SUPPORTED gate exists for attributes outside the 4 canonical codes", async () => {
  const source = await read("lib/pim/publication-eligibility.ts");
  assert.match(source, /SUPPORTED_ATTRIBUTE_CODES = \["material", "conexao", "comprimento", "volume"\]/);
  assert.match(source, /ATTRIBUTE_NOT_SUPPORTED/);
});

// ---------- publication service: atomicity, lock ordering, idempotency ----------

test("publishBatch: whole operation runs inside one transaction under the publication advisory lock", async () => {
  const source = await read("lib/pim/publication-service.ts");
  assert.match(source, /export async function publishBatch/);
  const fn = source.slice(source.indexOf("export async function publishBatch"), source.indexOf("export async function unpublishBatch"));
  assert.match(fn, /getDatabase\(\)\.transaction\(async \(tx\) => withPublicationLock\(tx, async \(\) => \{/);
  assert.doesNotMatch(fn, /getDatabase\(\)\.execute/, "every statement must run on tx or rollback would not cover it");
});

test("publishBatch: fresh eligibility re-check happens INSIDE the transaction, after the idempotent-replay short-circuit, before any write", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const fn = source.slice(source.indexOf("export async function publishBatch"), source.indexOf("export async function unpublishBatch"));
  const replayIdx = fn.indexOf("idempotentReplay: true");
  const eligibilityIdx = fn.indexOf("evaluatePublicationEligibility(tx, identity)");
  const insertBatchIdx = fn.indexOf("insert into public.pim_publication_batches");
  const insertPavIdx = fn.indexOf("insert into public.pim_attribute_publications");
  assert.ok(replayIdx !== -1 && eligibilityIdx !== -1 && insertBatchIdx !== -1 && insertPavIdx !== -1);
  assert.ok(replayIdx < eligibilityIdx, "idempotent replay must short-circuit before re-evaluating eligibility");
  assert.ok(eligibilityIdx < insertBatchIdx && eligibilityIdx < insertPavIdx, "eligibility must be checked before any write");
});

test("publishBatch: batch id reuse with a different member fingerprint is rejected, never silently overwritten", async () => {
  const source = await read("lib/pim/publication-service.ts");
  assert.match(source, /existing\[0\]\.memberFingerprint !== fingerprint\) throw new PimPublicationBatchIdentityConflictError/);
});

test("publishBatch: duplicate member identity in the same call is rejected before any DB access", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const fn = source.slice(source.indexOf("export async function publishBatch"), source.indexOf("return getDatabase().transaction"));
  assert.match(fn, /new Set\(keys\)\.size !== keys\.length\) throw new PimPublicationDuplicateMemberError/);
});

test("publishBatch: never writes to product_attribute_values or attribute_values", async () => {
  const source = await read("lib/pim/publication-service.ts");
  assert.doesNotMatch(source, /insert into public\.product_attribute_values|update public\.product_attribute_values|delete from public\.product_attribute_values/);
  assert.doesNotMatch(source, /insert into public\.attribute_values|update public\.attribute_values|delete from public\.attribute_values/);
});

test("unpublishBatch: repeated call on an already rolled-back batch is idempotent (no error, no re-write)", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const fn = source.slice(source.indexOf("export async function unpublishBatch"));
  assert.match(fn, /batchRows\[0\]\.status === "rolled_back"\) \{/);
  const idempotentIdx = fn.indexOf('idempotentReplay: true');
  const updateIdx = fn.indexOf("update public.pim_attribute_publications");
  assert.ok(idempotentIdx !== -1 && updateIdx !== -1 && idempotentIdx < updateIdx);
});

test("unpublishBatch: only flips state on rows belonging to the given batch_id, never a DELETE, never touches source truth", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const fn = source.slice(source.indexOf("export async function unpublishBatch"));
  assert.match(fn, /update public\.pim_attribute_publications\s*\n\s*set state='unpublished', unpublished_at=now\(\)\s*\n\s*where batch_id=\$\{batchId\}::uuid and state='published'/);
  assert.doesNotMatch(fn, /delete from/);
});

test("unpublishBatch: audit trail written for every row it actually unpublishes", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const fn = source.slice(source.indexOf("export async function unpublishBatch"));
  assert.match(fn, /'ATTRIBUTE_UNPUBLISHED'/);
});

test("publishBatch: audit trail operation is ATTRIBUTE_PUBLISHED, one row per published identity", async () => {
  const source = await read("lib/pim/publication-service.ts");
  assert.match(source, /'ATTRIBUTE_PUBLISHED'/);
});

// ---------- read model: never trusts pim_attribute_publications alone ----------

test("read model: getPublishedProductAttributes requires the identity to still exist in product_attribute_values (not just a published state row)", async () => {
  const source = await read("lib/pim/publication-read-model.ts");
  const fn = source.slice(source.indexOf("export async function getPublishedProductAttributes"));
  assert.match(fn, /join public\.product_attribute_values pav\s*\n\s*on pav\.product_id = pap\.product_id\s*\n\s*and pav\.attribute_id = pap\.attribute_id\s*\n\s*and pav\.attribute_value_id = pap\.attribute_value_id/);
  assert.match(fn, /where pap\.product_id = \$\{productId\}::uuid and pap\.state = 'published'/);
});

test("read model: never uses attributes.status as the publication authority", async () => {
  const source = await read("lib/pim/publication-read-model.ts");
  assert.doesNotMatch(source, /a\.status\s*=\s*'active'/);
});

test("canary membership lookup only considers active canary batches, never full/rolled_back", async () => {
  const source = await read("lib/pim/publication-read-model.ts");
  const fn = source.slice(source.indexOf("export async function getActiveCanaryMembership"));
  assert.match(fn, /b\.kind = 'canary' and b\.status = 'active'/);
});

// ---------- storefront isolation: nothing here is wired into the public read path yet ----------

test("services/catalog/postgres.ts (storefront) is untouched by this phase", async () => {
  const source = await read("services/catalog/postgres.ts");
  assert.doesNotMatch(source, /pim_attribute_publications|pim_publication_batches|publication-read-model|publication-service/);
});

test("no route/page/action imports the publication service or read model yet (foundation only, not wired to storefront/UI)", async () => {
  const { execSync } = await import("node:child_process");
  let matches = [];
  try {
    const output = execSync('git grep -l "publication-service\\|publication-read-model" -- "app" "components"', { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    matches = output.trim().split("\n").filter(Boolean);
  } catch (error) {
    // git grep exits 1 (not an execution failure) when it finds no matches at all -- that is the expected, passing case.
    if (error.status !== 1) throw error;
  }
  assert.deepEqual(matches, [], "publication service/read-model must not be imported by app/ or components/ yet");
});
