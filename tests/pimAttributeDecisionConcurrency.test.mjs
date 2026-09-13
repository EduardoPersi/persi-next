import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pimAttributeDecisionSchema } from "../lib/validation/pimEditorial.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const baseInput = {
  productId: "00000000-0000-4000-8000-000000000001",
  attributeId: "00000000-0000-4000-8000-000000000002",
  approvedAttributeValueIds: ["00000000-0000-4000-8000-000000000003"],
  rejectedAttributeValueIds: [],
  reason: "cor padrao confirmada visualmente",
};

test("schema: first decision (no row yet) is expressed as expectedDecisionVersion=0", () => {
  const parsed = pimAttributeDecisionSchema.parse({ ...baseInput, expectedDecisionVersion: "0" });
  assert.equal(parsed.expectedDecisionVersion, 0n);
});

test("schema: accepts a later version as a plain non-negative bigint (N -> N+1 shape)", () => {
  const parsed = pimAttributeDecisionSchema.parse({ ...baseInput, expectedDecisionVersion: "7" });
  assert.equal(parsed.expectedDecisionVersion, 7n);
});

test("schema: rejects a negative expectedDecisionVersion", () => {
  assert.throws(() => pimAttributeDecisionSchema.parse({ ...baseInput, expectedDecisionVersion: "-1" }));
});

test("schema: expectedDecisionVersion is required (strict object, no silent default)", () => {
  assert.throws(() => pimAttributeDecisionSchema.parse(baseInput));
});

test("migration: pim_attribute_decisions table exists, forward-only, RLS enabled, no backfill inserts", async () => {
  const migration = await read("supabase/migrations/20260913150000_pim_attribute_decision_versioning.sql");
  assert.match(migration, /create table public\.pim_attribute_decisions/);
  assert.match(migration, /primary key \(product_id, attribute_id\)/);
  assert.match(migration, /version bigint not null default 0/);
  assert.match(migration, /alter table public\.pim_attribute_decisions enable row level security/);
  // No backfill: existing pim_attribute_reviews rows (Tesoura, Martelo) are
  // left untouched; every pair starts coherently at version 0.
  assert.doesNotMatch(migration, /insert into public\.pim_attribute_decisions/);
  assert.doesNotMatch(migration, /update public\.pim_attribute_reviews/);
});

test("existing migrations are not modified by this phase", async () => {
  const foundation = await read("supabase/migrations/20260827120000_pim_v1_foundation.sql");
  assert.match(foundation, /create table public\.pim_attribute_reviews/);
  assert.doesNotMatch(foundation, /pim_attribute_decisions/);
});

test("reviewPimAttribute: version check happens under the advisory lock, before any write", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  const lockIdx = source.indexOf("pg_advisory_xact_lock");
  const staleCheckIdx = source.indexOf("throw new PimAttributeStaleDecisionError()");
  const reviewsInsertIdx = source.indexOf("insert into pim_attribute_reviews");
  const decisionsInsertIdx = source.indexOf("insert into pim_attribute_decisions");
  const auditInsertIdx = source.indexOf("insert into pim_audit_log");
  assert.ok(lockIdx !== -1 && staleCheckIdx !== -1 && reviewsInsertIdx !== -1 && decisionsInsertIdx !== -1 && auditInsertIdx !== -1);
  assert.ok(lockIdx < staleCheckIdx, "version must be compared only after the advisory lock is held");
  assert.ok(staleCheckIdx < reviewsInsertIdx, "stale check must run before any pim_attribute_reviews write");
  assert.ok(staleCheckIdx < decisionsInsertIdx, "stale check must run before the version is incremented");
  assert.ok(staleCheckIdx < auditInsertIdx, "stale check must run before any audit row is written");
});

test("reviewPimAttribute: a stale submission writes nothing (zero reviews, zero decision-version bump, zero audit)", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  const fn = source.slice(source.indexOf("export async function reviewPimAttribute"));
  const staleThrow = fn.match(/if \(BigInt\(match\.decisionVersion\) !== input\.expectedDecisionVersion\) throw new PimAttributeStaleDecisionError\(\);/);
  assert.ok(staleThrow, "stale comparison must throw synchronously, not schedule any write");
  // The comparison is a single guarded throw with no side effect before it in
  // the same statement, and everything mutating (reviews loop, version
  // upsert, audit insert) is textually after this line — already asserted
  // by the ordering test above.
});

test("reviewPimAttribute: decision version increments N -> N+1 via a single atomic upsert, first write seeds version 1", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  assert.match(source, /insert into pim_attribute_decisions\(product_id,attribute_id,version,updated_at\)/);
  assert.match(source, /values\(\$\{input\.productId\}::uuid,\$\{input\.attributeId\}::uuid,1,now\(\)\)/);
  assert.match(source, /on conflict\(product_id,attribute_id\) do update set version=pim_attribute_decisions\.version\+1,updated_at=now\(\)/);
});

test("reviewPimAttribute: whole operation (lock, checks, reviews, version, audit) is one transaction — atomic rollback on any failure", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  assert.match(source, /return getDatabase\(\)\.transaction\(async \(tx\) => \{/);
  const fn = source.slice(source.indexOf("return getDatabase().transaction"));
  assert.doesNotMatch(fn, /getDatabase\(\)\.execute/, "every statement inside must run on tx, not a separate connection, or rollback would not cover it");
});

test("reviewPimAttribute: advisory lock pattern preserved unchanged from A3.4", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended\(\$\{input\.productId\} \|\| ':' \|\| \$\{input\.attributeId\}, 0\)\)/);
});

test("reviewPimAttribute: multi-value approval and decision-change are still supported alongside versioning", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  assert.match(source, /if \(match\.cardinality === "single" && input\.approvedAttributeValueIds\.length !== 1\)/);
  assert.match(source, /"ATTRIBUTE_DECISION_CHANGED" : "ATTRIBUTE_DECISION_RECORDED"/);
  // Martelo's real future correction (Amarelo approved / Preto rejected ->
  // both approved) needs no special case: any subset of real candidate ids
  // in approvedAttributeValueIds is accepted for cardinality=multiple.
  assert.doesNotMatch(source, /approvedAttributeValueIds\.length\s*[<>]=?\s*\d+.*cardinality === "multiple"/);
});

test("reviewPimAttribute: exactly one audit row per call (no duplicate auditing, double submit cannot double-audit)", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  assert.equal((source.match(/insert into pim_audit_log/g) ?? []).length, 1);
  // A duplicated submit after the first one committed carries the same
  // expectedDecisionVersion (N), but current is now N+1 — it is rejected by
  // the same stale check, so it can never reach the audit insert a second
  // time for the same logical decision.
});

test("reviewPimAttribute: source evidence (product_attribute_values) is never mutated", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  assert.doesNotMatch(source, /insert into product_attribute_values|update product_attribute_values|delete from product_attribute_values/);
});

test("reviewPimAttribute: still never touches suggestions, editorial profile, conflicts, publication or operational catalog", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  assert.doesNotMatch(source, /into pim_suggestions|into pim_product_profiles|into pim_conflicts|update pim_conflicts|from pim_suggestions|from pim_product_profiles|decidePimSuggestion|transitionPimEditorial/);
  assert.doesNotMatch(source, /publish|published_at/i);
  assert.doesNotMatch(source, /\bproducts\b|\bproduct_variants\b|\bprices\b|\binventory_levels\b/);
});

test("decidePimConflictAttribute (A3.2B) is untouched by this phase and shares no version table with reviewPimAttribute", async () => {
  const source = await read("lib/pim/workflow.ts");
  assert.match(source, /export async function decidePimConflictAttribute/);
  assert.doesNotMatch(source, /pim_attribute_decisions/);
});

test("Server Action: reads and forwards expectedDecisionVersion, sanitized stale error, no raw error.message leak", async () => {
  const actions = await read("app/admin/products/[id]/actions.ts");
  assert.match(actions, /PimAttributeStaleDecisionError/);
  assert.match(actions, /expectedDecisionVersion:BigInt\(String\(formData\.get\("expectedDecisionVersion"\)\?\?"0"\)\)/);
  assert.match(actions, /requireAdminPermission\("pim\.attribute\.review",\{rateLimit:true\}\)/);
  assert.doesNotMatch(actions, /error\.message/);
});

test("repository: attribute groups expose decisionVersion, defaulting to 0 with no pim_attribute_decisions row", async () => {
  const repository = await read("lib/pim/repository.ts");
  assert.match(repository, /coalesce\(d\.version,0\)::text "decisionVersion"/);
  assert.match(repository, /left join pim_attribute_decisions d on d\.product_id=pav\.product_id and d\.attribute_id=pav\.attribute_id/);
  assert.match(repository, /decisionVersion:string/);
});

test("UI: stale decision shows a specific message and a refresh action, never a silent overwrite or auto-merge", async () => {
  const component = await read("components/admin/PimAttributeReview.tsx");
  assert.match(component, /expectedDecisionVersion/);
  assert.match(component, /isStale=state\.code==="PIM_ATTRIBUTE_STALE_DECISION"/);
  assert.match(component, /Atualizar dados/);
  assert.match(component, /router\.refresh\(\)/);
  assert.doesNotMatch(component, /merge|reaplicar/i);
});
