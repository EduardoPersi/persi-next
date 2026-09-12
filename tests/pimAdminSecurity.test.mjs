import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {evaluateAdminPolicy} from "../lib/admin/policy.ts";
import {permissionForWorkflowAction,roleHasPermission} from "../lib/admin/permissions.ts";
import {MemoryAdminRateLimiter} from "../lib/admin/rate-limit.ts";

const active=(role="PIM_REVIEWER")=>({id:"00000000-0000-4000-8000-000000000001",identityProvider:"supabase_auth",identitySubject:"10000000-0000-4000-8000-000000000001",role,status:"active",revokedAt:null});

test("customer and WordPress roles without native membership are denied",()=>{
 for(const legacyRole of ["customer","shop_manager","administrator"]){assert.equal(evaluateAdminPolicy({membership:null,permission:"pim.admin.read",mfa:"verified"}).code,"MEMBERSHIP_REQUIRED");assert.equal(roleHasPermission(legacyRole,"pim.admin.read"),false)}
});
test("inactive revoked and invalid memberships fail closed",()=>{
 assert.equal(evaluateAdminPolicy({membership:{...active(),status:"inactive"},permission:"pim.admin.read",mfa:"verified"}).code,"MEMBERSHIP_INACTIVE");
 assert.equal(evaluateAdminPolicy({membership:{...active(),status:"revoked",revokedAt:new Date()},permission:"pim.admin.read",mfa:"verified"}).code,"MEMBERSHIP_INACTIVE");
 assert.equal(evaluateAdminPolicy({membership:active("SUPERADMIN"),permission:"pim.admin.read",mfa:"verified"}).code,"ROLE_INVALID");
});
test("role matrix is operation-specific",()=>{
 for(const permission of ["pim.draft.edit","pim.workflow.submit","pim.workflow.reopen","pim.workflow.discard","pim.suggestion.review"])assert.equal(roleHasPermission("PIM_REVIEWER",permission),true);
 for(const permission of ["pim.workflow.approve","pim.workflow.reject"])assert.equal(roleHasPermission("PIM_REVIEWER",permission),false);
 assert.equal(roleHasPermission("PIM_APPROVER","pim.workflow.approve"),true);assert.equal(roleHasPermission("PIM_APPROVER","pim.workflow.reject"),true);assert.equal(roleHasPermission("PIM_APPROVER","pim.draft.edit"),false);
 assert.equal(roleHasPermission("ADMIN","pim.suggestion.extract_deterministic"),true);
});
test("unknown workflow operation and permission are denied",()=>{assert.equal(permissionForWorkflowAction("PUBLISH"),null);assert.equal(roleHasPermission("ADMIN","pim.publish"),false)});
test("MFA unknown or false denies and verified continues evaluation",()=>{
 assert.equal(evaluateAdminPolicy({membership:active(),permission:"pim.admin.read",mfa:"unknown"}).code,"MFA_REQUIRED");
 assert.equal(evaluateAdminPolicy({membership:active(),permission:"pim.admin.read",mfa:"not_verified"}).code,"MFA_REQUIRED");
 assert.equal(evaluateAdminPolicy({membership:active(),permission:"pim.admin.read",mfa:"verified"}).allowed,true);
});
test("membership revocation immediately changes decision",()=>{const membership=active();assert.equal(evaluateAdminPolicy({membership,permission:"pim.admin.read",mfa:"verified"}).allowed,true);assert.equal(evaluateAdminPolicy({membership:{...membership,status:"revoked",revokedAt:new Date()},permission:"pim.admin.read",mfa:"verified"}).allowed,false)});
test("rate limiter isolates identity and operation and denies over limit",async()=>{let now=0;const limiter=new MemoryAdminRateLimiter(2,100,()=>now),key={identitySubject:"one",operation:"approve"};assert.equal(await limiter.consume(key),true);assert.equal(await limiter.consume(key),true);assert.equal(await limiter.consume(key),false);assert.equal(await limiter.consume({...key,identitySubject:"two"}),true);assert.equal(await limiter.consume({...key,operation:"review"}),true);now=101;assert.equal(await limiter.consume(key),true)});
test("all reachable mutations authorize independently and errors are sanitized",async()=>{const actions=await readFile(new URL("../app/admin/products/[id]/actions.ts",import.meta.url),"utf8");for(const name of ["saveEditorialDraft","runEditorialWorkflow","reviewSuggestion"])assert.match(actions,new RegExp(`function ${name}`));assert.ok((actions.match(/requireAdminPermission\(/g)??[]).length>=3);assert.match(actions,/permissionForWorkflowAction/);assert.doesNotMatch(actions,/error\.message/);assert.match(actions,/correlationId/)});
test("audit attribution is complete and deterministic extraction remains unreachable",async()=>{const [workflow,actions,page,migration]=await Promise.all(["../lib/pim/workflow.ts","../app/admin/products/[id]/actions.ts","../app/admin/products/[id]/page.tsx","../supabase/migrations/20260910230000_native_admin_security_foundation.sql"].map(path=>readFile(new URL(path,import.meta.url),"utf8")));for(const field of ["actor_identity_provider","actor_identity_subject","admin_membership_id","effective_role","correlation_id"])assert.match(workflow,new RegExp(field));assert.doesNotMatch(actions,/extractDeterministicSuggestions|generateDeterministicSuggestions/);assert.doesNotMatch(page,/extractDeterministicSuggestions/);assert.doesNotMatch(actions,/PUBLISH/);assert.match(migration,/enable row level security/);assert.match(migration,/revoke all.*public,anon,authenticated/s)});
test("proxy is identity-only defense in depth for admin",async()=>{const [proxy,middleware,authorization]=await Promise.all(["../proxy.ts","../lib/auth/middleware.ts","../lib/admin/authorization.ts"].map(path=>readFile(new URL(path,import.meta.url),"utf8")));assert.match(proxy,/\/admin\/:path\*/);assert.match(middleware,/"\/admin"/);assert.doesNotMatch(proxy,/admin_memberships|getDatabase/);assert.match(authorization,/admin_memberships/)});
