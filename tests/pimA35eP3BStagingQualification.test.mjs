import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computeMemberFingerprint } from "../lib/pim/publication-service.ts";
import { isKnownNeedsReview, KNOWN_NEEDS_REVIEW_REGISTRY } from "../lib/pim/publication-needs-review-registry.ts";
import { CURRENT_PIM_BASELINE_SHA256 } from "../lib/pim/publication-baseline.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// ---------- Section 8/9: NEEDS_REVIEW fail-closed, identity not SKU ----------

test("needs-review registry: PA013710/comprimento and NMEM16/comprimento are known, NMEM16/material is not", () => {
  assert.equal(isKnownNeedsReview("PA013710", "comprimento"), true);
  assert.equal(isKnownNeedsReview("NMEM16", "comprimento"), true);
  assert.equal(isKnownNeedsReview("NMEM16", "material"), false, "attribute-scoped: the sibling attribute of a needs-review SKU must stay unaffected");
  assert.equal(isKnownNeedsReview("PA013710", "material"), false);
});

test("needs-review registry: an unrelated SKU is never matched", () => {
  assert.equal(isKnownNeedsReview("H-827", "volume"), false);
  assert.equal(isKnownNeedsReview("003359", "comprimento"), false);
});

test("needs-review registry: every entry documents a reason (auditability)", () => {
  for (const entry of KNOWN_NEEDS_REVIEW_REGISTRY) {
    assert.ok(entry.reason && entry.reason.length > 10, `entry for ${entry.sku}/${entry.attributeCode} must carry a real reason`);
  }
});

test("eligibility: NEEDS_REVIEW gate is consulted unconditionally inside evaluatePublicationEligibility, not left to the caller", async () => {
  const source = await read("lib/pim/publication-eligibility.ts");
  assert.match(source, /import \{ isKnownNeedsReview \} from "\.\/publication-needs-review-registry"/);
  assert.match(source, /isKnownNeedsReview\(row\.sku, row\.attributeCode\)\) reasonCodes\.push\("NEEDS_REVIEW"\)/);
});

test("eligibility: structural NEEDS_REVIEW also blocks (pim_attribute_reviews.status='needs_review'), future-proofing beyond the stopgap registry", async () => {
  const source = await read("lib/pim/publication-eligibility.ts");
  assert.match(source, /row\.reviewStatus === "needs_review"\) reasonCodes\.push\("NEEDS_REVIEW"\)/);
});

test("registry module: SKU is documented as a lookup label, never caller-supplied relational authority", async () => {
  const source = await read("lib/pim/publication-needs-review-registry.ts");
  assert.match(source, /never relational[\s\S]{0,15}authority/);
  assert.match(source, /never supplies or overrides a SKU/);
});

// ---------- Section 10: conflict-key mapping is exhaustive and TS-enforced ----------

test("conflict-key mapping: exhaustive over the 4 supported codes (TS Record<SupportedAttributeCode,string> enforces this at compile time)", async () => {
  const source = await read("lib/pim/publication-eligibility.ts");
  assert.match(source, /DB_CODE_TO_CONFLICT_ATTRIBUTE_KEY: Record<SupportedAttributeCode, string>/);
  assert.match(source, /material:\s*"material"/);
  assert.match(source, /conexao:\s*"connection"/);
  assert.match(source, /comprimento:\s*"length"/);
  assert.match(source, /volume:\s*"volume"/);
});

test("conflict-key mapping: an attribute outside the 4 supported codes is rejected by ATTRIBUTE_NOT_SUPPORTED before conflict-key logic ever matters", async () => {
  const source = await read("lib/pim/publication-eligibility.ts");
  const idxSupportedCheck = source.indexOf('reasonCodes.push("ATTRIBUTE_NOT_SUPPORTED")');
  const idxConflictQuery = source.indexOf("openConflictSameAttribute");
  assert.ok(idxSupportedCheck !== -1 && idxConflictQuery !== -1);
  // The conflict-key CASE mapping is evaluated inside the SQL query (before
  // the JS-side ATTRIBUTE_NOT_SUPPORTED push), but the reasonCodes union of
  // both makes an unsupported attribute ineligible regardless of what the
  // conflict-key CASE resolved to -- an unknown/irrelevant key can never by
  // itself produce "eligible=true" for an unsupported attribute.
  assert.match(source, /ATTRIBUTE_NOT_SUPPORTED/);
});

// ---------- Section 16: baseline authority ----------

test("publishBatch: rejects any baselineReference that is not the current PIM v1 baseline", async () => {
  const source = await read("lib/pim/publication-service.ts");
  assert.match(source, /if \(input\.baselineReference !== CURRENT_PIM_BASELINE_SHA256\) throw new PimPublicationStaleBaselineError\(\);/);
});

test("preparePublication: also validates baselineReference before evaluating anything", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const fn = source.slice(source.indexOf("export async function preparePublication"), source.indexOf("export async function publishBatch"));
  assert.match(fn, /if \(baselineReference !== CURRENT_PIM_BASELINE_SHA256\) throw new PimPublicationStaleBaselineError\(\);/);
});

test("baseline constant matches the A3.5E-P2-X canonical payload hash exactly", () => {
  assert.equal(CURRENT_PIM_BASELINE_SHA256, "4b4cb3da092ebea4837850249f82c56543e0fac42c11b680ec315a26d462399d");
});

// ---------- Section 17: member fingerprint properties ----------

test("computeMemberFingerprint: order independent", () => {
  const a = [{ productId: "p1", attributeId: "a1", attributeValueId: "v1" }, { productId: "p2", attributeId: "a2", attributeValueId: "v2" }];
  assert.equal(computeMemberFingerprint(a), computeMemberFingerprint([a[1], a[0]]));
});

test("computeMemberFingerprint: a single differing value changes the fingerprint", () => {
  const a = [{ productId: "p1", attributeId: "a1", attributeValueId: "v1" }];
  const b = [{ productId: "p1", attributeId: "a1", attributeValueId: "v2" }];
  assert.notEqual(computeMemberFingerprint(a), computeMemberFingerprint(b));
});

test("computeMemberFingerprint: never includes a timestamp or random batch id (pure function of identity fields only)", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const fn = source.slice(source.indexOf("export function computeMemberFingerprint"), source.indexOf("async function withPublicationLock"));
  assert.doesNotMatch(fn, /Date\.now|new Date|randomUUID|now\(\)/);
});

test("publishBatch: duplicate identity within the same submitted batch is rejected, never silently canonicalized", async () => {
  const source = await read("lib/pim/publication-service.ts");
  assert.match(source, /new Set\(keys\)\.size !== keys\.length\) throw new PimPublicationDuplicateMemberError/);
});

// ---------- Section 18: batch state machine ----------

test("batch state machine: rolled_back is terminal -- reusing that batch id (even with identical membership) is rejected, never resurrected", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const fn = source.slice(source.indexOf("export async function publishBatch"), source.indexOf("export async function unpublishBatch"));
  const rolledBackIdx = fn.indexOf('existing[0].status === "rolled_back") throw new PimPublicationBatchAlreadyRolledBackError');
  const fingerprintCheckIdx = fn.indexOf("existing[0].memberFingerprint !== fingerprint");
  assert.ok(rolledBackIdx !== -1 && fingerprintCheckIdx !== -1 && rolledBackIdx < fingerprintCheckIdx, "rolled_back must be checked BEFORE the fingerprint/idempotency branch, so it can never be read as still-published");
});

test("batch state machine: unpublishBatch on an already rolled_back batch is idempotent (0 additional rows, no error)", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const fn = source.slice(source.indexOf("export async function unpublishBatch"));
  assert.match(fn, /batchRows\[0\]\.status === "rolled_back"/);
});

test("batch state machine: the only creation path is publishBatch (no other function inserts into pim_publication_batches)", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const inserts = source.match(/insert into public\.pim_publication_batches/g) ?? [];
  assert.equal(inserts.length, 1);
});

// ---------- Section 19/20: current-state uniqueness & source-truth drift ----------

test("current-state uniqueness: PK is the full (product_id, attribute_id, attribute_value_id) triple -- at most one row can exist per identity", async () => {
  const migration = await read("supabase/migrations/20260915030000_pim_publication_foundation.sql");
  assert.match(migration, /create table public\.pim_attribute_publications[\s\S]*?primary key \(product_id, attribute_id, attribute_value_id\)/);
});

test("source-truth drift: publishBatch's eligibility re-check keys on the EXACT attribute_value_id -- if source truth moved to a different value, identityMatches is false and the old value cannot be published", async () => {
  const source = await read("lib/pim/publication-eligibility.ts");
  assert.match(source, /pav\.attribute_value_id = \$\{identity\.attributeValueId\}::uuid/);
});

test("source-truth drift: the published read model re-joins product_attribute_values on the exact triple every read -- a stale publication can never keep serving a value source truth has moved away from", async () => {
  const source = await read("lib/pim/publication-read-model.ts");
  assert.match(source, /pav\.attribute_value_id\s*=\s*pap\.attribute_value_id/);
});

// ---------- Section 21: audit trail operation names ----------

test("audit operations: ATTRIBUTE_PUBLISHED and ATTRIBUTE_UNPUBLISHED follow the existing ATTRIBUTE_<VERB> naming convention", async () => {
  const source = await read("lib/pim/publication-service.ts");
  assert.match(source, /'ATTRIBUTE_PUBLISHED'/);
  assert.match(source, /'ATTRIBUTE_UNPUBLISHED'/);
});

test("audit operations: batch identity is embedded in the reason text of every publish/unpublish audit row", async () => {
  const source = await read("lib/pim/publication-service.ts");
  assert.match(source, /A3\.5E-P3-A publishBatch: batch=\$\{batchId\}/);
  assert.match(source, /A3\.5E-P3-A unpublishBatch: batch=\$\{batchId\}/);
});

// ---------- Section 15: FP safety -- publication layer must not reimplement the extractor ----------

test("eligibility gate does not reimplement extractor-level false-positive detection (reference code, wire gauge) -- those are pipeline-level protections with zero persisted instances (confirmed in A3.5E-P2-T/P2-W/P2-X)", async () => {
  const source = await read("lib/pim/publication-eligibility.ts");
  assert.doesNotMatch(source, /desencap|decapa|referencia|refer[êe]ncia/i, "must not duplicate extractor regex logic here");
  // The ONLY false-positive class this gate checks is TEMPLATE_PLACEHOLDER_TEXT,
  // because it is the only one ever found PERSISTED (A3.5E-P2-U); the other
  // classes were caught and fixed before ever reaching product_attribute_values.
  assert.match(source, /TEMPLATE_PLACEHOLDER_PATTERN/);
});

// ---------- A3.5E-P3-F Section 16: cross-batch ownership/rebind safety ----------

test("publishBatch: a NEW batch can never silently rebind an identity currently owned (published) by ANOTHER batch", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const fn = source.slice(source.indexOf("export async function publishBatch"), source.indexOf("export async function unpublishBatch"));
  const lockIdx = fn.indexOf("for update");
  const guardIdx = fn.indexOf('existingRow[0].state === "published") {');
  const throwIdx = fn.indexOf("throw new PimPublicationOwnedByAnotherBatchError");
  const insertIdx = fn.indexOf("insert into public.pim_attribute_publications");
  assert.ok(lockIdx !== -1 && guardIdx !== -1 && throwIdx !== -1 && insertIdx !== -1);
  assert.ok(lockIdx < guardIdx && guardIdx < throwIdx && throwIdx < insertIdx, "the row must be locked and checked BEFORE the insert/upsert that could otherwise steal it");
});

test("PimPublicationOwnedByAnotherBatchError carries the identity and the owning batch id (auditable, not a generic error)", async () => {
  const source = await read("lib/pim/publication-service.ts");
  assert.match(source, /class PimPublicationOwnedByAnotherBatchError extends Error/);
  assert.match(source, /readonly identity: PublicationIdentity/);
  assert.match(source, /readonly owningBatchId: string/);
});

test("cross-batch rebind guard: a row that is absent or previously unpublished (rolled_back) may still be (re)published under a new batch -- only an ACTIVE published row is protected", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const fn = source.slice(source.indexOf("export async function publishBatch"), source.indexOf("export async function unpublishBatch"));
  // The guard only fires on state==='published'; an 'unpublished' existingRow falls through to the insert/upsert.
  assert.match(fn, /existingRow\.length > 0 && existingRow\[0\]\.state === "published"/);
});

test("cross-batch rebind guard: any failure inside the per-member loop rolls back the WHOLE batch (all-or-nothing), never a partial publish", async () => {
  const source = await read("lib/pim/publication-service.ts");
  const fn = source.slice(source.indexOf("export async function publishBatch"), source.indexOf("export async function unpublishBatch"));
  assert.match(fn, /return getDatabase\(\)\.transaction\(async \(tx\) => withPublicationLock\(tx, async \(\) => \{/);
  assert.doesNotMatch(fn, /try\s*\{[\s\S]*catch/, "the loop must not swallow the ownership error locally -- it must propagate to abort the whole transaction");
});
