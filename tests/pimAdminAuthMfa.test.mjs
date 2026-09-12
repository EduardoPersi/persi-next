import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mapSupabaseAal } from "../lib/admin-auth/assurance.ts";
import { safeAdminDestination } from "../lib/admin-auth/redirect.ts";
import { evaluateAdminPolicy } from "../lib/admin/policy.ts";

const membership = (role="PIM_REVIEWER",status="active") => ({id:"00000000-0000-4000-8000-000000000001",identityProvider:"supabase_auth",identitySubject:"10000000-0000-4000-8000-000000000001",role,status,revokedAt:status==="revoked"?new Date():null});
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Supabase AAL is mapped fail closed",()=>{
  assert.equal(mapSupabaseAal("aal2"),"verified");
  assert.equal(mapSupabaseAal("aal1"),"not_verified");
  assert.equal(mapSupabaseAal(undefined),"unknown");
  assert.equal(mapSupabaseAal("aal2",true),"unknown");
});
test("AAL1 enrollment incomplete and unknown assurance cannot reach protected admin",()=>{
  for(const mfa of ["not_verified","unknown"])assert.equal(evaluateAdminPolicy({membership:membership(),permission:"pim.admin.read",mfa}).code,"MFA_REQUIRED");
  assert.equal(evaluateAdminPolicy({membership:null,permission:"pim.admin.read",mfa:"verified"}).code,"MEMBERSHIP_REQUIRED");
  assert.equal(evaluateAdminPolicy({membership:membership("PIM_REVIEWER","revoked"),permission:"pim.admin.read",mfa:"verified"}).allowed,false);
});
test("admin identity is isolated from customer and never authorized by email or metadata",async()=>{
  const [identity,authorization,migration]=await Promise.all([read("lib/admin-auth/identity.ts"),read("lib/admin/authorization.ts"),read("supabase/migrations/20260910230000_native_admin_security_foundation.sql")]);
  assert.match(identity,/getUser\(\)/);assert.match(identity,/identityProvider: "supabase_auth"/);
  assert.match(authorization,/identity_provider='supabase_auth'/);assert.doesNotMatch(authorization,/customers|customer_identities|email|user_metadata|app_metadata/);
  assert.doesNotMatch(migration,/insert into public\.admin_memberships/i);
});
test("admin login has no signup and returns a non-enumerating error",async()=>{
  const [page,actions,errors]=await Promise.all([read("app/admin/login/page.tsx"),read("app/admin/login/actions.ts"),read("lib/admin-auth/errors.ts")]);
  assert.match(actions,/signInWithPassword/);assert.doesNotMatch(`${page}\n${actions}`,/signUp|criar conta|cadastro/i);
  assert.doesNotMatch(actions,/error\.message/);assert.match(errors,/Não foi possível autenticar com os dados informados/);
});
test("TOTP enrollment challenge and verification use Supabase factor state",async()=>{
  const actions=await read("app/admin/mfa/actions.ts");
  for(const operation of ["listFactors","enroll","challenge","verify"])assert.match(actions,new RegExp(`mfa\\.${operation}`));
  assert.doesNotMatch(actions,/console\.|totp.*secret|localStorage/i);assert.match(actions,/signOut\(\{ scope: "local" \}\)/);
});
test("redirect destinations are an exact internal allowlist",()=>{
  assert.equal(safeAdminDestination("/admin/pim"),"/admin/pim");
  for(const unsafe of ["https://evil.example","//evil.example","/admin/products/123","javascript:alert(1)"])assert.equal(safeAdminDestination(unsafe),"/admin/products");
});
test("protected pages and each mutation retain independent authorization",async()=>{
  const [pim,products,detail,actions]=await Promise.all([read("app/admin/pim/page.tsx"),read("app/admin/products/page.tsx"),read("app/admin/products/[id]/page.tsx"),read("app/admin/products/[id]/actions.ts")]);
  for(const page of [pim,products,detail])assert.match(page,/requirePimAdmin\(\)/);
  assert.ok((actions.match(/requireAdminPermission\(/g)??[]).length>=3);assert.doesNotMatch(actions,/extractDeterministicSuggestions|PUBLISH/);
});
test("admin auth cookies are HttpOnly and protected content is not cached",async()=>{
  const [config,proxy,layout]=await Promise.all([read("lib/admin-auth/config.ts"),read("proxy.ts"),read("app/admin/layout.tsx")]);
  assert.match(config,/httpOnly: true/);assert.match(config,/sameSite: "lax"/);assert.doesNotMatch(config,/domain:/i);
  assert.match(proxy,/private, no-store/);assert.match(layout,/force-dynamic/);
});
test("publication and public deterministic extraction remain disabled",async()=>{
  const [actions,detail]=await Promise.all([read("app/admin/products/[id]/actions.ts"),read("app/admin/products/[id]/page.tsx")]);
  assert.doesNotMatch(`${actions}\n${detail}`,/publish action|publishPim|extractDeterministicSuggestions/i);
});
