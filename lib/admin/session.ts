import "server-only";
import {randomBytes,randomUUID} from "node:crypto";
import {cookies} from "next/headers";
import {sql} from "drizzle-orm";
import {getDatabase} from "@/lib/db";
import type {VerifiedAdminIdentity} from "@/lib/admin-auth/identity";
import {hashAdminSessionCapability,validAdminSessionCapability} from "./session-capability";

export const ADMIN_SESSION_IDLE_SECONDS=30*60;
export const ADMIN_SESSION_ABSOLUTE_SECONDS=8*60*60;
export const ADMIN_SESSION_TOUCH_SECONDS=5*60;
export const ADMIN_MFA_FRESH_SECONDS=15*60;
export const ADMIN_SESSION_COOKIE=process.env.NODE_ENV==="production"?"__Host-persi_admin_capability":"persi_admin_capability";
const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict" as const,path:"/"};

export {hashAdminSessionCapability,validAdminSessionCapability} from "./session-capability";
export type ActiveAdminSession={id:string;identitySubject:string;mfaVerifiedAt:Date;expiresAt:Date};

export async function establishAdminSession(identity:VerifiedAdminIdentity){
 if(identity.assurance!=="verified")throw new Error("MFA_REQUIRED");
 const capability=randomBytes(32).toString("base64url"),hash=hashAdminSessionCapability(capability),correlationId=randomUUID();
 const rows=await getDatabase().execute(sql`with created as(
  insert into admin_sessions(identity_provider,identity_subject,capability_hash,expires_at,idle_expires_at,mfa_verified_at)
  values('supabase_auth',${identity.identitySubject},${hash},now()+${ADMIN_SESSION_ABSOLUTE_SECONDS}*interval '1 second',now()+${ADMIN_SESSION_IDLE_SECONDS}*interval '1 second',now()) returning *
 ),audited as(insert into admin_session_audit(admin_session_id,identity_provider,identity_subject,operation,correlation_id)
  select id,identity_provider,identity_subject,'session_established',${correlationId}::uuid from created)
 select id from created`);
 if(!(rows as unknown as {id:string}[])[0])throw new Error("ADMIN_SESSION_UNAVAILABLE");
 (await cookies()).set(ADMIN_SESSION_COOKIE,capability,{...cookieOptions,maxAge:ADMIN_SESSION_ABSOLUTE_SECONDS});
 return {sessionId:(rows as unknown as {id:string}[])[0].id,correlationId};
}

export async function resolveAdminSession(identity:VerifiedAdminIdentity):Promise<ActiveAdminSession|null>{
 if(identity.assurance!=="verified")return null;
 const capability=(await cookies()).get(ADMIN_SESSION_COOKIE)?.value;if(!validAdminSessionCapability(capability))return null;
 const hash=hashAdminSessionCapability(capability);
 const rows=await getDatabase().execute(sql`update admin_sessions set
  last_seen_at=case when last_seen_at<=now()-${ADMIN_SESSION_TOUCH_SECONDS}*interval '1 second' then now() else last_seen_at end,
  idle_expires_at=case when last_seen_at<=now()-${ADMIN_SESSION_TOUCH_SECONDS}*interval '1 second' then least(expires_at,now()+${ADMIN_SESSION_IDLE_SECONDS}*interval '1 second') else idle_expires_at end
 where capability_hash=${hash} and identity_provider='supabase_auth' and identity_subject=${identity.identitySubject}
   and revoked_at is null and expires_at>now() and idle_expires_at>now()
 returning id,identity_subject "identitySubject",mfa_verified_at "mfaVerifiedAt",expires_at "expiresAt"`);
 return (rows as unknown as ActiveAdminSession[])[0]??null;
}

async function revoke(hash:string,reason:string,operation:string,actorSessionId?:string){const correlationId=randomUUID();return getDatabase().execute(sql`with changed as(
 update admin_sessions set revoked_at=coalesce(revoked_at,now()),revocation_reason=coalesce(revocation_reason,${reason}),revoked_by_session_id=coalesce(revoked_by_session_id,${actorSessionId??null}::uuid)
 where capability_hash=${hash} and revoked_at is null returning *
),audited as(insert into admin_session_audit(admin_session_id,actor_session_id,identity_provider,identity_subject,operation,reason,correlation_id)
 select id,${actorSessionId??null}::uuid,identity_provider,identity_subject,${operation},${reason},${correlationId}::uuid from changed)
select id from changed`)}
export async function revokeCurrentAdminSession(reason="logout"){const store=await cookies(),value=store.get(ADMIN_SESSION_COOKIE)?.value;try{if(validAdminSessionCapability(value))await revoke(hashAdminSessionCapability(value),reason,reason==="logout"?"logout":"session_revoked")}finally{store.delete(ADMIN_SESSION_COOKIE)}}
export async function revokeAllAdminSessions(identitySubject:string,actorSessionId?:string){const correlationId=randomUUID();return getDatabase().execute(sql`with changed as(
 update admin_sessions set revoked_at=coalesce(revoked_at,now()),revocation_reason=coalesce(revocation_reason,'revoke_all'),revoked_by_session_id=coalesce(revoked_by_session_id,${actorSessionId??null}::uuid)
 where identity_provider='supabase_auth' and identity_subject=${identitySubject} and revoked_at is null returning *
),audited as(insert into admin_session_audit(admin_session_id,actor_session_id,identity_provider,identity_subject,operation,reason,correlation_id)
 select id,${actorSessionId??null}::uuid,identity_provider,identity_subject,'sessions_revoked_all','revoke_all',${correlationId}::uuid from changed)
select id from changed`)}
