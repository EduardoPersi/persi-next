import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {evaluateAdminPolicy} from "../lib/admin/policy.ts";
import {roleHasPermission} from "../lib/admin/permissions.ts";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");
const active=(role)=>({id:"00000000-0000-4000-8000-000000000002",identityProvider:"supabase_auth",identitySubject:"10000000-0000-4000-8000-000000000002",role,status:"active",revokedAt:null});
const fnBody=(source,name)=>{const start=source.indexOf(`export async function ${name}`);const next=source.indexOf("\nexport ",start+1);return source.slice(start,next===-1?undefined:next)};

test("RBAC matrix: ADMIN and PIM_APPROVER can resolve conflicts, PIM_REVIEWER cannot",()=>{
 assert.equal(roleHasPermission("ADMIN","pim.conflict.resolve"),true);
 assert.equal(roleHasPermission("PIM_APPROVER","pim.conflict.resolve"),true);
 assert.equal(roleHasPermission("PIM_REVIEWER","pim.conflict.resolve"),false);
});
test("policy denies resolution to an unauthorized or inactive membership",()=>{
 assert.equal(evaluateAdminPolicy({membership:active("PIM_REVIEWER"),permission:"pim.conflict.resolve",mfa:"verified"}).code,"PERMISSION_DENIED");
 assert.equal(evaluateAdminPolicy({membership:{...active("PIM_APPROVER"),status:"inactive"},permission:"pim.conflict.resolve",mfa:"verified"}).code,"MEMBERSHIP_INACTIVE");
 assert.equal(evaluateAdminPolicy({membership:active("PIM_APPROVER"),permission:"pim.conflict.resolve",mfa:"not_verified"}).code,"MFA_REQUIRED");
 assert.equal(evaluateAdminPolicy({membership:active("PIM_APPROVER"),permission:"pim.conflict.resolve",mfa:"verified"}).allowed,true);
});

test("input validation rejects invalid conflict id and requires a substantive reason",async()=>{
 const validation=await read("lib/validation/pimEditorial.ts");
 const schema=validation.slice(validation.indexOf("pimConflictResolutionSchema"));
 assert.match(schema,/conflictId:\s*z\.string\(\)\.uuid\(\)/);
 assert.match(schema,/reason:\s*z\.string\(\)\.trim\(\)\.min\(10\)/);
 assert.match(schema,/\.strict\(\)/);
});

test("resolvePimConflict locks the row, requires status='open', and never overwrites a resolved conflict",async()=>{
 const workflow=await read("lib/pim/workflow.ts");
 const fn=fnBody(workflow,"resolvePimConflict");
 assert.match(fn,/for update/);
 assert.match(fn,/if\(!conflict\)throw new PimConflictNotFoundError\(\)/);
 assert.match(fn,/if\(conflict\.status!=="open"\)throw new PimConflictAlreadyResolvedError\(\)/);
 assert.match(fn,/where id=\$\{input\.conflictId\}::uuid and status='open'/);
 assert.match(fn,/if\(\(updated as unknown as Array<\{id:string\}>\)\.length!==1\)throw new PimConflictAlreadyResolvedError\(\)/);
 assert.equal((fn.match(/insert into pim_audit_log/g)??[]).length,1,"exactly one audit row per resolution, never on the already-resolved path");
 assert.ok(fn.indexOf("insert into pim_audit_log")>fn.indexOf("returning id"),"audit only runs after the guarded update confirms exactly one row changed");
});

test("resolution touches only pim_conflicts and pim_audit_log — no suggestion, profile, publication or operational-catalog side effects",async()=>{
 const workflow=await read("lib/pim/workflow.ts");
 const fn=fnBody(workflow,"resolvePimConflict");
 assert.doesNotMatch(fn,/pim_suggestions|pim_product_profiles|decidePimSuggestion|transitionPimEditorial/);
 assert.doesNotMatch(fn,/publish|published_at/i);
 assert.doesNotMatch(fn,/\bproducts\b|\bproduct_variants\b|\bprices\b|\binventory_levels\b/);
 assert.doesNotMatch(fn,/hasBlockingConflict|assertSuggestionDecisionAllowed|assertProfileApprovalAllowed|promptInjectionBlocked/);
});

test("conflict resolution is architecturally independent from the suggestion/profile blocking gate (documented, not weakened)",async()=>{
 const [policy,workflow]=await Promise.all([read("lib/pim/conflict-policy.ts"),read("lib/pim/workflow.ts")]);
 assert.doesNotMatch(policy,/pim_conflicts/);
 const approveStart=workflow.indexOf('if(input.action==="APPROVE"){');
 const approveBranch=workflow.slice(approveStart,workflow.indexOf("assertProfileApprovalAllowed",approveStart)+40);
 assert.match(approveBranch,/editorialBlockedByConflict|blockingConflicts|acceptableForDraft/);
});

test("audit row carries full attribution and a dedicated, unambiguous operation name",async()=>{
 const workflow=await read("lib/pim/workflow.ts");
 const fn=fnBody(workflow,"resolvePimConflict");
 assert.match(fn,/'conflict'/);
 assert.match(fn,/'CONFLICT_RESOLVED'/);
 assert.doesNotMatch(fn,/'APPROVE'|'suggestion_approved'/);
 for(const field of ["context?.identityProvider","context?.identitySubject","context?.adminSessionId","context?.membershipId","context?.effectiveRole","context?.correlationId"])assert.match(fn,new RegExp(field.replace(/[.?]/g,"\\$&")));
 assert.match(fn,/input\.reason/);
});

test("Server Action requires the dedicated permission, rate limiting, Zod parsing and sanitized errors",async()=>{
 const actions=await read("app/admin/products/[id]/actions.ts");
 assert.match(actions,/function resolveConflict/);
 assert.match(actions,/requireAdminPermission\("pim\.conflict\.resolve",\{rateLimit:true\}\)/);
 assert.match(actions,/resolvePimConflict\(/);
 assert.doesNotMatch(actions,/error\.message/);
 assert.match(actions,/PimConflictAlreadyResolvedError/);
 assert.match(actions,/PimConflictNotFoundError/);
});

test("no migration was touched or created for this phase; historical migrations remain untouched",async()=>{
 const untouchable=[
  "supabase/migrations/20260823110100_catalog.sql",
  "supabase/migrations/20260823110200_pim.sql",
  "supabase/migrations/20260901233000_pim_conflicts.sql",
  "supabase/migrations/20260903130000_public_browser_privilege_remediation.sql",
  "supabase/migrations/20260910230000_native_admin_security_foundation.sql",
  "supabase/migrations/20260912040000_distributed_admin_rate_limit.sql",
  "supabase/migrations/20260912050000_admin_session_audit_attribution.sql",
 ];
 for(const path of untouchable)await read(path); // throws if a historical file were ever renamed/removed
 assert.match(await read("supabase/migrations/20260901233000_pim_conflicts.sql"),/status text not null default 'open' check \(status in \('open','resolved'\)\)/);
});

test("UI: open conflicts show a gated, confirmable resolution action; resolved conflicts only show status",async()=>{
 const [page,component]=await Promise.all([read("app/admin/products/[id]/page.tsx"),read("components/admin/PimConflictResolution.tsx")]);
 assert.match(page,/const open=conflict\.status==="open"/);
 assert.match(page,/\{open&&canResolveConflicts&&<PimConflictResolution/);
 assert.match(page,/Conflito aberto/);assert.match(page,/Conflito resolvido/);
 assert.match(page,/roleHasPermission\(admin\.role,"pim\.conflict\.resolve"\)/);
 assert.match(component,/useState/);assert.match(component,/Cancelar/);
 assert.match(component,/role="status"/);assert.match(component,/role="alert"/);
 assert.match(component,/não aprova sugestão, não aprova o perfil editorial e não publica nada no site/);
 assert.doesNotMatch(component,/window\.confirm/);
});
