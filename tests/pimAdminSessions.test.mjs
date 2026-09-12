import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("A2.2B stores only an opaque capability HMAC with bounded TTLs",async()=>{
 const [session,capability,migration]=await Promise.all([read("lib/admin/session.ts"),read("lib/admin/session-capability.ts"),read("supabase/migrations/20260912030000_native_admin_session_registry.sql")]);
 assert.match(session,/randomBytes\(32\).*base64url/s);assert.match(capability,/createHmac\("sha256"/);
 assert.match(session,/ADMIN_SESSION_IDLE_SECONDS=30\*60/);assert.match(session,/ADMIN_SESSION_ABSOLUTE_SECONDS=8\*60\*60/);
 assert.doesNotMatch(migration,/access_token|refresh_token|totp_secret|authorization_header/i);
 assert.match(migration,/capability_hash text not null unique/);
});
test("A2.2B authorization requires real MFA then native session before membership",async()=>{
 const authorization=await read("lib/admin/authorization.ts");
 const boundary=authorization.slice(authorization.indexOf("export async function requireAdminPermission"));
 const mfa=boundary.indexOf('identity.assurance!=="verified"'),session=boundary.indexOf("resolveAdminSession"),membership=boundary.indexOf("evaluateAdminPolicy");
 assert.ok(mfa>0&&session>mfa&&membership>session);assert.match(authorization,/SESSION_REQUIRED/);
});
test("session creation occurs after successful TOTP and logout revokes first",async()=>{
 const actions=await read("app/admin/mfa/actions.ts");
 const verify=actions.slice(actions.indexOf("export async function verifyAdminTotp"));
 const logout=actions.slice(actions.indexOf("export async function adminLogout"));
 assert.ok(verify.indexOf("mfa.verify")<verify.indexOf("establishAdminSession"));
 assert.ok(logout.indexOf("revokeCurrentAdminSession()")<logout.indexOf('signOut({ scope: "local" })'));
});
test("registry is browser closed and audit covers lifecycle",async()=>{
 const migration=await read("supabase/migrations/20260912030000_native_admin_session_registry.sql");
 assert.match(migration,/force row level security/g);assert.match(migration,/from public,anon,authenticated/);
 for(const operation of ["session_established","session_revoked","sessions_revoked_all","logout","session_denied"])assert.match(migration,new RegExp(operation));
});
test("touch cannot resurrect or extend absolute TTL and revocation is monotonic",async()=>{
 const session=await read("lib/admin/session.ts");
 assert.match(session,/revoked_at is null and expires_at>now\(\) and idle_expires_at>now\(\)/);
 assert.match(session,/least\(expires_at,now\(\)/);assert.match(session,/revoked_at=coalesce\(revoked_at,now\(\)\)/);
});
