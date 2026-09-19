import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateAdminPolicy } from "../lib/admin/policy.ts";
import { roleHasPermission } from "../lib/admin/permissions.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const active = (role) => ({ id: "00000000-0000-4000-8000-000000000003", identityProvider: "supabase_auth", identitySubject: "10000000-0000-4000-8000-000000000003", role, status: "active", revokedAt: null });
const fnBody = (source, name) => {
  const start = source.indexOf(`export async function ${name}`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
};

test("no-review is a distinct, never-approved default in the repository query", async () => {
  const repository = await read("lib/pim/repository.ts");
  assert.doesNotMatch(repository, /coalesce\(r\.status::text,'approved'\)/);
  assert.match(repository, /reviewStatus:"approved"\|"rejected"\|null/);
});

test("UI never displays 'Aprovado no PIM' merely from absence of a review row", async () => {
  const page = await read("app/admin/products/[id]/page.tsx");
  assert.match(page, /reviewStatus==="approved"\?"Aprovado no PIM":value\.reviewStatus==="rejected"\?"Rejeitado":"Sem revisão"/);
});

// A3.7-FINAL-A, Workstream A: the human-approval-before-publication policy
// (Section 4/6) requires an approver to be able to exercise
// pim.attribute.review, not only the editorial workflow.approve/reject
// permissions -- this was the exact RBAC gap the operator hit as a
// "missing Approve button" (A3.7-A-R17-R1's finding). PIM_APPROVER now has
// it too, least-privilege (no other permission changed alongside it).
test("RBAC: ADMIN, PIM_REVIEWER and PIM_APPROVER can all review attributes", () => {
  assert.equal(roleHasPermission("ADMIN", "pim.attribute.review"), true);
  assert.equal(roleHasPermission("PIM_REVIEWER", "pim.attribute.review"), true);
  assert.equal(roleHasPermission("PIM_APPROVER", "pim.attribute.review"), true);
});

test("policy denies attribute review to an inactive or unverified membership, allows any verified authorized role including PIM_APPROVER", () => {
  assert.equal(evaluateAdminPolicy({ membership: { ...active("PIM_REVIEWER"), status: "inactive" }, permission: "pim.attribute.review", mfa: "verified" }).code, "MEMBERSHIP_INACTIVE");
  assert.equal(evaluateAdminPolicy({ membership: active("PIM_REVIEWER"), permission: "pim.attribute.review", mfa: "not_verified" }).code, "MFA_REQUIRED");
  assert.equal(evaluateAdminPolicy({ membership: active("PIM_REVIEWER"), permission: "pim.attribute.review", mfa: "verified" }).allowed, true);
  assert.equal(evaluateAdminPolicy({ membership: active("PIM_APPROVER"), permission: "pim.attribute.review", mfa: "verified" }).allowed, true);
});

test("candidate listing works without any pim_conflicts row and exposes cardinality", async () => {
  const source = await read("lib/pim/attribute-conflict.ts");
  assert.match(source, /export async function listAttributeCandidates/);
  const fn = fnBody(source, "listAttributeCandidates");
  assert.doesNotMatch(fn, /pim_conflicts/);
  assert.match(fn, /a\.cardinality::text/);
});

test("reviewPimAttribute requires every real candidate to be explicitly classified, and enforces single cardinality", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /if \(!allRealCovered \|\| !noForeignIds\) throw new PimAttributeInvalidSelectionError/);
  assert.match(source, /if \(match\.cardinality === "single" && input\.approvedAttributeValueIds\.length !== 1\)/);
});

test("reviewPimAttribute never touches suggestions, editorial profile, conflicts, publication or operational catalog", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  assert.doesNotMatch(source, /into pim_suggestions|into pim_product_profiles|into pim_conflicts|update pim_conflicts|from pim_suggestions|from pim_product_profiles|decidePimSuggestion|transitionPimEditorial/);
  assert.doesNotMatch(source, /publish|published_at/i);
  assert.doesNotMatch(source, /\bproducts\b|\bproduct_variants\b|\bprices\b|\binventory_levels\b/);
});

test("changing a decision preserves history: upsert updates state, a fresh audit row records the change distinctly", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  assert.match(source, /on conflict\(product_id,attribute_id,attribute_value_id\) do update/);
  assert.match(source, /const alreadyDecided = match\.candidates\.some/);
  assert.match(source, /"ATTRIBUTE_DECISION_CHANGED" : "ATTRIBUTE_DECISION_RECORDED"/);
  assert.equal((source.match(/insert into pim_audit_log/g) ?? []).length, 1);
});

test("audit carries full attribution: actor, session, membership, role, correlation id, reason, and both alternatives", async () => {
  const source = await read("lib/pim/attribute-review.ts");
  for (const field of ["context?.identityProvider", "context?.identitySubject", "context?.adminSessionId", "context?.membershipId", "context?.effectiveRole", "context?.correlationId"]) {
    assert.match(source, new RegExp(field.replace(/[.?]/g, "\\$&")));
  }
  assert.match(source, /input\.reason/);
  assert.match(source, /approved: approvedValues, rejected: rejectedValues/);
});

test("Server Action requires the dedicated permission and rate limiting, and errors stay sanitized", async () => {
  const actions = await read("app/admin/products/[id]/actions.ts");
  assert.match(actions, /function reviewAttribute/);
  assert.match(actions, /requireAdminPermission\("pim\.attribute\.review",\{rateLimit:true\}\)/);
  assert.match(actions, /reviewPimAttribute\(/);
  assert.doesNotMatch(actions, /error\.message/);
});

test("compound measurement display values are never split by the candidate listing", async () => {
  const source = await read("lib/pim/attribute-conflict.ts");
  assert.doesNotMatch(source, /\.split\(/);
  assert.doesNotMatch(source, /normalizeMeasurement|measurement_numerator|measurement_denominator/);
});

test("friendly admin identity replaces supabase:<uuid> for display, without weakening authorization", async () => {
  const [identity, authorization] = await Promise.all([
    read("lib/admin-auth/identity.ts"),
    read("lib/admin/authorization.ts"),
  ]);
  assert.doesNotMatch(authorization, /`supabase:\$\{identity\.identitySubject\}`/);
  assert.match(authorization, /actorReference:identity\.displayName/);
  // authorization itself still keys exclusively on identitySubject/membership, never on email/displayName
  assert.match(authorization, /findMembership\(identity\.identitySubject\)/);
  assert.doesNotMatch(authorization, /displayName.*findMembership|email.*findMembership/);
  assert.match(identity, /Display-only, never used for authorization/);
});

test("manual creation of a brand-new canonical attribute_value is not implemented, and is not silently faked", async () => {
  const [reviewAction, component] = await Promise.all([
    read("lib/pim/attribute-review.ts"),
    read("components/admin/PimAttributeReview.tsx"),
  ]);
  assert.doesNotMatch(reviewAction, /insert into attribute_values/);
  assert.doesNotMatch(component, /outro valor|novo valor/i);
});

test("attribute summary is computed read-only per request, not persisted", async () => {
  const repository = await read("lib/pim/repository.ts");
  assert.match(repository, /attributeSummary/);
  assert.doesNotMatch(repository, /insert into|update .*attribute_summary/i);
});

test("no migration was required for A3.4; pim_attribute_reviews schema is reused as-is", async () => {
  const foundation = await read("supabase/migrations/20260827120000_pim_v1_foundation.sql");
  assert.match(foundation, /create table public\.pim_attribute_reviews/);
});
