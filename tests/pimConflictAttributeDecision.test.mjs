import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const fnBody = (source, name) => {
  const start = source.indexOf(`export async function ${name}`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
};

test("ATTRIBUTE_ALIASES is exported and reused, not duplicated, for the reverse lookup", async () => {
  const [extractor, attributeConflict] = await Promise.all([
    read("lib/pim/extractor.ts"),
    read("lib/pim/attribute-conflict.ts"),
  ]);
  assert.match(extractor, /export const ATTRIBUTE_ALIASES/);
  assert.match(attributeConflict, /import\s*\{\s*ATTRIBUTE_ALIASES\s*\}\s*from\s*"\.\/extractor\.ts"/);
  // no second, parallel alias dictionary was invented
  assert.doesNotMatch(attributeConflict, /cor:\s*["']color["']/);
});

test("candidate lookup is read-only, reuses immutable_unaccent_lower, and requires 2+ real assigned values", async () => {
  const source = await read("lib/pim/attribute-conflict.ts");
  assert.match(source, /product_attribute_values/);
  assert.match(source, /immutable_unaccent_lower/);
  assert.match(source, /pim_attribute_reviews/);
  assert.match(source, /if \(rows\.length < 2\) return null;/);
  assert.doesNotMatch(source, /insert |update |delete /i);
});

test("decidePimConflictAttribute is atomic: lock, validate open, validate candidate membership, persist review, resolve, audit", async () => {
  const workflow = await read("lib/pim/workflow.ts");
  const fn = fnBody(workflow, "decidePimConflictAttribute");
  assert.match(fn, /getDatabase\(\)\.transaction/);
  assert.match(fn, /for update/);
  assert.match(fn, /if\(!conflict\)throw new PimConflictNotFoundError\(\)/);
  assert.match(fn, /if\(conflict\.status!=="open"\)throw new PimConflictAlreadyResolvedError\(\)/);
  assert.match(fn, /if\(!match\|\|match\.candidates\.length<2\)throw new PimConflictInvalidValueError\(\)/);
  assert.match(fn, /const chosen=match\.candidates\.find/);
  assert.match(fn, /if\(!chosen\)throw new PimConflictInvalidValueError\(\)/);
  // the resolved-conflict write keeps the exact same double guard as the plain resolution path
  assert.match(fn, /where id=\$\{input\.conflictId\}::uuid and status='open' returning id/);
  assert.match(fn, /if\(\(updated as unknown as Array<\{id:string\}>\)\.length!==1\)throw new PimConflictAlreadyResolvedError\(\)/);
});

test("every candidate gets an explicit pim_attribute_reviews decision (approved or rejected), none left ambiguous", async () => {
  const workflow = await read("lib/pim/workflow.ts");
  const fn = fnBody(workflow, "decidePimConflictAttribute");
  assert.match(fn, /insert into pim_attribute_reviews/);
  assert.match(fn, /on conflict\(product_id,attribute_id,attribute_value_id\) do update/);
  assert.match(fn, /\$\{approved\?"approved":"rejected"\}/);
  assert.match(fn, /for\(const candidate of match\.candidates\)/);
});

test("decision is audited once, with all alternatives and the chosen value, under its own operation name", async () => {
  const workflow = await read("lib/pim/workflow.ts");
  const fn = fnBody(workflow, "decidePimConflictAttribute");
  assert.equal((fn.match(/insert into pim_audit_log/g) ?? []).length, 1);
  assert.match(fn, /'CONFLICT_ATTRIBUTE_DECIDED'/);
  assert.doesNotMatch(fn, /'CONFLICT_RESOLVED'/);
  assert.match(fn, /JSON\.stringify\(alternatives\)/);
  assert.match(fn, /chosen\.displayValue/);
  assert.match(fn, /input\.reason/);
  for (const field of ["context?.identityProvider", "context?.identitySubject", "context?.adminSessionId", "context?.membershipId", "context?.effectiveRole", "context?.correlationId"]) {
    assert.match(fn, new RegExp(field.replace(/[.?]/g, "\\$&")));
  }
});

test("attribute decision never touches suggestions, editorial profile, publication or the operational catalog", async () => {
  const workflow = await read("lib/pim/workflow.ts");
  const fn = fnBody(workflow, "decidePimConflictAttribute");
  assert.doesNotMatch(fn, /pim_suggestions|pim_product_profiles|decidePimSuggestion|transitionPimEditorial/);
  assert.doesNotMatch(fn, /publish|published_at/i);
  assert.doesNotMatch(fn, /\bproduct_variants\b|\bprices\b|\binventory_levels\b/);
  assert.doesNotMatch(fn, /hasBlockingConflict|assertSuggestionDecisionAllowed|assertProfileApprovalAllowed|promptInjectionBlocked/);
  // it does write product_attribute_values' sibling review table, but never the assignment table itself
  assert.doesNotMatch(fn, /update product_attribute_values|insert into product_attribute_values|delete from product_attribute_values/);
});

test("Server Action reuses the pim.conflict.resolve permission — no new permission invented for the same underlying decision", async () => {
  const [actions, permissions] = await Promise.all([
    read("app/admin/products/[id]/actions.ts"),
    read("lib/admin/permissions.ts"),
  ]);
  assert.match(actions, /function decideConflictAttribute/);
  assert.match(actions, /requireAdminPermission\("pim\.conflict\.resolve",\{rateLimit:true\}\)/);
  assert.match(actions, /decidePimConflictAttribute\(/);
  assert.equal((permissions.match(/"pim\.conflict\.resolve"/g) ?? []).length >= 1, true);
});

test("UI requires a single explicit selection before enabling submission, and never uses a bare confirm dialog", async () => {
  const component = await read("components/admin/PimConflictAttributeDecision.tsx");
  assert.match(component, /type="radio"/);
  assert.match(component, /disabled=\{pending\|\|!selected\}/);
  assert.match(component, /required/);
  assert.match(component, /role="status"/);
  assert.match(component, /role="alert"/);
  assert.doesNotMatch(component, /window\.confirm/);
  assert.match(component, /não aprova sugestão, não aprova o perfil editorial e não publica nada no site/);
});

test("page shows the approved value distinctly from rejected alternatives once resolved, and flags pre-existing undecided resolutions instead of guessing", async () => {
  const page = await read("app/admin/products/[id]/page.tsx");
  assert.match(page, /Valor aprovado no PIM:/);
  assert.match(page, /candidate\.reviewStatus==="approved"\?"aprovado no PIM":candidate\.reviewStatus==="rejected"\?"rejeitado"/);
  assert.match(page, /nenhum valor específico foi registrado como aprovado/);
});

test("compound measurement values are never split or reinterpreted by the alias/candidate matcher", async () => {
  const source = await read("lib/pim/attribute-conflict.ts");
  assert.doesNotMatch(source, /\.split\(/);
  assert.doesNotMatch(source, /normalizeMeasurement|measurement_numerator|measurement_denominator/);
});

test("no schema migration was required or created for this phase", async () => {
  const foundation = await read("supabase/migrations/20260827120000_pim_v1_foundation.sql");
  assert.match(foundation, /constraint pim_attribute_reviews_assignment_unique unique\(product_id,attribute_id,attribute_value_id\)/);
  assert.match(foundation, /constraint pim_attribute_decision_check check \(status='needs_review' or \(reviewed_by is not null and reviewed_at is not null\)\)/);
});
