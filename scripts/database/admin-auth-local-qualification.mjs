import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { mapSupabaseAal } from "../../lib/admin-auth/assurance.ts";
import { evaluateAdminPolicy } from "../../lib/admin/policy.ts";
import { hashAdminSessionCapability } from "../../lib/admin/session-capability.ts";

if (process.env.PERSI_OFFLINE_VALIDATION !== "1") {
  throw new Error("OFFLINE_VALIDATION_REQUIRED");
}

function localStatus() {
  const cli = path.resolve("node_modules/.bin/supabase.cmd");
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `& '${cli}' status -o json`],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
  );
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("LOCAL_SUPABASE_STATUS_UNAVAILABLE");
  return JSON.parse(output.slice(start, end + 1));
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.toUpperCase().replace(/=+$/u, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("INVALID_LOCAL_TOTP_SECRET");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function currentTotp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

const status = localStatus();
assert.match(status.API_URL, /^http:\/\/127\.0\.0\.1:/u);
assert.match(status.DB_URL, /^postgresql:\/\/postgres:postgres@127\.0\.0\.1:/u);
process.env.DATABASE_URL = status.DB_URL;
const {savePimEditorialDraft} = await import("../../lib/pim/workflow.ts");
const {closeDatabaseForTests} = await import("../../lib/db/index.ts");

const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const auth = createClient(status.API_URL, status.ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const database = postgres(status.DB_URL, { max: 1 });
const email = `a22a-q1-${crypto.randomUUID()}@local.invalid`;
const password = `Q1!${crypto.randomBytes(24).toString("base64url")}aA7`;
let userId;
let membershipId;
let factorId;
const productId=crypto.randomUUID();
const variantId=crypto.randomUUID();

const result = {
  publicSignupRejected: false,
  primaryAuth: false,
  postLoginAal: null,
  serverGetUser: false,
  verifiedSubject: false,
  totpEnroll: false,
  totpFactorCreated: false,
  totpChallenge: false,
  invalidTotpRejected: false,
  validTotpAccepted: false,
  postVerifyAal: null,
  serverGetUserAfterAal2: false,
  applicationMfaAssurance: false,
  aal2NoMembershipDenied: false,
  aal2ActiveAllowedMembership: false,
  aal2RevokedMembershipDenied: false,
  aal2WrongRoleDenied: false,
  aal1ActiveMembershipDenied: false,
  unknownMfaDenied: false,
  wpAdminDenied: false,
  wpShopManagerDenied: false,
  cleanupMembership: false,
  cleanupUser: false,
  nativeSessionLifecycle: false,
  providerValidAfterNativeRevoke: false,
  revokeOneScoped: false,
  revokeAll: false,
  negativeSessionBinding: false,
  expirationDenied: false,
  touchCannotResurrectOrExtend: false,
  concurrentSessionSafety: false,
  distributedRateLimitIntegrated: false,
  protectedPimMutation: false,
  pimAuditSessionAttribution: false,
  auditSurvivesRevocation: false,
  crossSessionAuditAttribution: false,
};

function candidate(row) {
  return row
    ? {
        id: row.id,
        identityProvider: row.identity_provider,
        identitySubject: row.identity_subject,
        role: row.role,
        status: row.status,
        revokedAt: row.revoked_at,
      }
    : null;
}

async function findNativeMembership(subject) {
  const rows = await database`
    select id, identity_provider, identity_subject, role, status, revoked_at
    from public.admin_memberships
    where identity_provider = 'supabase_auth' and identity_subject = ${subject}
    order by created_at desc limit 1
  `;
  return candidate(rows[0]);
}

try {
  const publicSignup = await auth.auth.signUp({
    email: `public-signup-${crypto.randomUUID()}@local.invalid`,
    password: `Blocked!${crypto.randomBytes(24).toString("base64url")}aA7`,
  });
  assert.ok(publicSignup.error);
  result.publicSignupRejected = true;

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  userId = created.data.user.id;
  assert.match(userId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu);

  const signedIn = await auth.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  result.primaryAuth = true;

  const aal1 = await auth.auth.mfa.getAuthenticatorAssuranceLevel();
  assert.ifError(aal1.error);
  assert.equal(aal1.data.currentLevel, "aal1");
  result.postLoginAal = aal1.data.currentLevel;

  const serverAtAal1 = await auth.auth.getUser(signedIn.data.session.access_token);
  assert.ifError(serverAtAal1.error);
  result.serverGetUser = true;
  result.verifiedSubject = serverAtAal1.data.user.id === userId;
  assert.equal(result.verifiedSubject, true);

  const enrolled = await auth.auth.mfa.enroll({ factorType: "totp", friendlyName: "A2.2A Q1 local" });
  assert.ifError(enrolled.error);
  factorId = enrolled.data.id;
  result.totpEnroll = true;
  result.totpFactorCreated = Boolean(factorId);

  const invalidChallenge = await auth.auth.mfa.challenge({ factorId });
  assert.ifError(invalidChallenge.error);
  result.totpChallenge = true;
  const validCode = currentTotp(enrolled.data.totp.secret);
  const invalidCode = validCode === "000000" ? "111111" : "000000";
  const invalid = await auth.auth.mfa.verify({
    factorId,
    challengeId: invalidChallenge.data.id,
    code: invalidCode,
  });
  assert.ok(invalid.error);
  result.invalidTotpRejected = true;

  const validChallenge = await auth.auth.mfa.challenge({ factorId });
  assert.ifError(validChallenge.error);
  const verified = await auth.auth.mfa.verify({
    factorId,
    challengeId: validChallenge.data.id,
    code: validCode,
  });
  assert.ifError(verified.error);
  result.validTotpAccepted = true;

  const aal2 = await auth.auth.mfa.getAuthenticatorAssuranceLevel();
  assert.ifError(aal2.error);
  assert.equal(aal2.data.currentLevel, "aal2");
  result.postVerifyAal = aal2.data.currentLevel;
  result.applicationMfaAssurance = mapSupabaseAal(aal2.data.currentLevel) === "verified";

  const session = await auth.auth.getSession();
  assert.ifError(session.error);
  const serverAtAal2 = await auth.auth.getUser(session.data.session.access_token);
  assert.ifError(serverAtAal2.error);
  result.serverGetUserAfterAal2 = serverAtAal2.data.user.id === userId;

  const noMembership = await findNativeMembership(userId);
  result.aal2NoMembershipDenied = !evaluateAdminPolicy({
    membership: noMembership,
    permission: "pim.workflow.approve",
    mfa: "verified",
  }).allowed;

  const inserted = await database`
    insert into public.admin_memberships
      (identity_provider, identity_subject, role, status, created_by)
    values ('supabase_auth', ${userId}, 'PIM_APPROVER', 'active', 'a22a-q1-local')
    returning id
  `;
  membershipId = inserted[0].id;
  const active = await findNativeMembership(userId);
  result.aal2ActiveAllowedMembership = evaluateAdminPolicy({
    membership: active,
    permission: "pim.workflow.approve",
    mfa: "verified",
  }).allowed;
  result.aal2WrongRoleDenied = !evaluateAdminPolicy({
    membership: active,
    permission: "pim.draft.edit",
    mfa: "verified",
  }).allowed;
  result.aal1ActiveMembershipDenied = !evaluateAdminPolicy({
    membership: active,
    permission: "pim.workflow.approve",
    mfa: "not_verified",
  }).allowed;
  result.unknownMfaDenied = !evaluateAdminPolicy({
    membership: active,
    permission: "pim.workflow.approve",
    mfa: "unknown",
  }).allowed;

  const wpMatches = await database`
    select count(*)::int as count from public.admin_memberships
    where identity_provider = 'supabase_auth'
      and identity_subject in ('wordpress:administrator', 'wordpress:shop_manager', ${email})
  `;
  assert.equal(wpMatches[0].count, 0);
  result.wpAdminDenied = true;
  result.wpShopManagerDenied = true;

  await database`
    update public.admin_memberships
    set status = 'revoked', revoked_at = now(), revoked_by = 'a22a-q1-local'
    where id = ${membershipId}
  `;
  const revoked = await findNativeMembership(userId);
  result.aal2RevokedMembershipDenied = !evaluateAdminPolicy({
    membership: revoked,
    permission: "pim.workflow.approve",
    mfa: "verified",
  }).allowed;

  const capabilityA = crypto.randomBytes(32).toString("base64url");
  const capabilityB = crypto.randomBytes(32).toString("base64url");
  const [sessionA] = await database`insert into public.admin_sessions(identity_provider,identity_subject,capability_hash,expires_at,idle_expires_at,mfa_verified_at) values('supabase_auth',${userId},${hashAdminSessionCapability(capabilityA)},now()+interval '8 hours',now()+interval '30 minutes',now()) returning id`;
  const [sessionB] = await database`insert into public.admin_sessions(identity_provider,identity_subject,capability_hash,expires_at,idle_expires_at,mfa_verified_at) values('supabase_auth',${userId},${hashAdminSessionCapability(capabilityB)},now()+interval '8 hours',now()+interval '30 minutes',now()) returning id`;
  const eligible = async (capability,subject=userId) => (await database`select count(*)::int count from public.admin_sessions where capability_hash=${hashAdminSessionCapability(capability)} and identity_subject=${subject} and identity_provider='supabase_auth' and revoked_at is null and expires_at>now() and idle_expires_at>now()`)[0].count===1;
  assert.equal(await eligible(capabilityA),true);result.nativeSessionLifecycle=true;
  await database`update public.admin_memberships set status='active',revoked_at=null,revoked_by=null where id=${membershipId}`;
  const correlationA=crypto.randomUUID(),correlationB=crypto.randomUUID();
  await database`insert into products(id,name,slug) values(${productId},'A2.2D local audit qualification',${`a22d-${productId}`})`;
  await database`insert into product_variants(id,product_id,sku) values(${variantId},${productId},${`A22D-${variantId}`})`;
  const draft=(name,version)=>({productId,version,commercialName:name,shortDescription:'Local only',description:'Synthetic local qualification',bulletPoints:[],application:'Local',specifications:'Synthetic',seoTitle:name,metaDescription:'Local only',searchTerms:[],imageAltText:'Synthetic product'});
  await savePimEditorialDraft(draft('Session A',0n),`supabase_auth:${userId}`,{identityProvider:'supabase_auth',identitySubject:userId,adminSessionId:sessionA.id,membershipId,effectiveRole:'PIM_APPROVER',correlationId:correlationA});
  await savePimEditorialDraft(draft('Session B',1n),`supabase_auth:${userId}`,{identityProvider:'supabase_auth',identitySubject:userId,adminSessionId:sessionB.id,membershipId,effectiveRole:'PIM_APPROVER',correlationId:correlationB});
  const auditRows=await database`select actor_identity_provider,actor_identity_subject,admin_session_id,admin_membership_id,effective_role,correlation_id from pim_audit_log where correlation_id in (${correlationA},${correlationB}) order by correlation_id`;
  result.protectedPimMutation=auditRows.length===2;
  result.pimAuditSessionAttribution=auditRows.every(row=>row.actor_identity_provider==='supabase_auth'&&row.actor_identity_subject===userId&&row.admin_membership_id===membershipId&&row.effective_role==='PIM_APPROVER');
  result.crossSessionAuditAttribution=auditRows.some(row=>row.correlation_id===correlationA&&row.admin_session_id===sessionA.id)&&auditRows.some(row=>row.correlation_id===correlationB&&row.admin_session_id===sessionB.id);
  await database`update public.admin_sessions set revoked_at=coalesce(revoked_at,now()),revocation_reason=coalesce(revocation_reason,'qualification_revoke_one') where id=${sessionA.id}`;
  result.auditSurvivesRevocation=(await database`select count(*)::int count from pim_audit_log where correlation_id=${correlationA} and admin_session_id=${sessionA.id}`)[0].count===1;
  assert.equal(await eligible(capabilityA),false);assert.equal(await eligible(capabilityB),true);result.revokeOneScoped=true;
  const stillVerified=await auth.auth.getUser((await auth.auth.getSession()).data.session.access_token);assert.ifError(stillVerified.error);result.providerValidAfterNativeRevoke=stillVerified.data.user.id===userId;
  result.negativeSessionBinding=!(await eligible(capabilityB,crypto.randomUUID()))&&!(await eligible(crypto.randomBytes(32).toString("base64url")));
  const [expired] = await database`insert into public.admin_sessions(identity_provider,identity_subject,capability_hash,created_at,last_seen_at,expires_at,idle_expires_at,mfa_verified_at) values('supabase_auth',${userId},${hashAdminSessionCapability(crypto.randomBytes(32).toString("base64url"))},now()-interval '9 hours',now()-interval '9 hours',now()-interval '1 hour',now()-interval '1 hour',now()-interval '9 hours') returning id`;
  result.expirationDenied=(await database`select count(*)::int count from admin_sessions where id=${expired.id} and expires_at>now() and idle_expires_at>now()`)[0].count===0;
  await database`update admin_sessions set revoked_at=now(),revocation_reason='qualification' where id=${sessionB.id}`;
  const [untouched]=await database`update admin_sessions set last_seen_at=now(),idle_expires_at=least(expires_at,now()+interval '30 minutes') where id=${sessionB.id} and revoked_at is null returning id`;
  result.touchCannotResurrectOrExtend=!untouched;
  await database`update admin_sessions set revoked_at=coalesce(revoked_at,now()),revocation_reason=coalesce(revocation_reason,'revoke_all') where identity_subject=${userId} and revoked_at is null`;
  result.revokeAll=(await database`select count(*)::int count from admin_sessions where identity_subject=${userId} and revoked_at is null`)[0].count===0;
  const capabilityC=crypto.randomBytes(32).toString("base64url");
  const [sessionC]=await database`insert into admin_sessions(identity_provider,identity_subject,capability_hash,expires_at,idle_expires_at,mfa_verified_at) values('supabase_auth',${userId},${hashAdminSessionCapability(capabilityC)},now()+interval '8 hours',now()+interval '30 minutes',now()) returning id`;
  await Promise.all([
    database`update admin_sessions set last_seen_at=now(),idle_expires_at=least(expires_at,now()+interval '30 minutes') where id=${sessionC.id} and revoked_at is null`,
    database`update admin_sessions set revoked_at=coalesce(revoked_at,now()),revocation_reason=coalesce(revocation_reason,'concurrent_revoke') where id=${sessionC.id}`,
  ]);
  const [concurrentFinal]=await database`select revoked_at,expires_at,idle_expires_at from admin_sessions where id=${sessionC.id}`;
  result.concurrentSessionSafety=Boolean(concurrentFinal.revoked_at)&&concurrentFinal.idle_expires_at<=concurrentFinal.expires_at&&!(await eligible(capabilityC));
  const rateKey=crypto.createHmac("sha256",process.env.ADMIN_RATE_LIMIT_HMAC_SECRET).update(userId).digest("hex");
  const [rateDecision]=await database`select allowed from consume_admin_rate_limit(${rateKey},'admin.mutation',30,60)`;
  result.distributedRateLimitIntegrated=rateDecision.allowed;

  for (const [key, value] of Object.entries(result)) {
    if (!key.startsWith("cleanup") && key !== "postLoginAal" && key !== "postVerifyAal") {
      assert.equal(value, true, key);
    }
  }
} finally {
  if (membershipId) {
    await database`delete from public.pim_audit_log where product_id=${productId}`;
    await database`delete from public.pim_product_profiles where product_id=${productId}`;
    await database`delete from public.product_variants where id=${variantId}`;
    await database`delete from public.products where id=${productId}`;
    await database`delete from public.admin_session_audit where identity_subject = ${userId}`;
    await database`delete from public.admin_rate_limits where bucket_key = ${crypto.createHmac("sha256",process.env.ADMIN_RATE_LIMIT_HMAC_SECRET).update(userId).digest("hex")}`;
    await database`delete from public.admin_sessions where identity_subject = ${userId}`;
    await database`delete from public.admin_memberships where id = ${membershipId}`;
    result.cleanupMembership = true;
  }
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    assert.ifError(deleted.error);
    result.cleanupUser = true;
  }
  await auth.auth.signOut({ scope: "local" }).catch(() => {});
  await closeDatabaseForTests();
  await database.end();
}

console.log(JSON.stringify(result, null, 2));
