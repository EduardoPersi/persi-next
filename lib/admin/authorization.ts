import "server-only";
import {randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {redirect} from "next/navigation";
import {verifyAdminIdentity} from "@/lib/admin-auth/identity";
import {getDatabase} from "@/lib/db";
import {evaluateAdminPolicy,type MembershipCandidate,type MfaAssurance} from "./policy";
import type {AdminPermission,AdminRole} from "./permissions";
import {enforceAdminRateLimit} from "./rate-limit";
import {resolveAdminSession} from "./session";
export type AuthorizedAdmin={identityProvider:"supabase_auth";identitySubject:string;sessionId:string;membershipId:string;role:AdminRole;correlationId:string;actorReference:string};
export class AdminAuthorizationError extends Error{constructor(readonly code:string,readonly correlationId:string){super(code)}}
export function getWordPressMfaAssurance():MfaAssurance{return "unknown"}
async function findMembership(identitySubject:string):Promise<MembershipCandidate|null>{const rows=await getDatabase().execute(sql`select id,identity_provider "identityProvider",identity_subject "identitySubject",role,status,revoked_at "revokedAt" from admin_memberships where identity_provider='supabase_auth' and identity_subject=${identitySubject} order by created_at desc limit 1`);return(rows as unknown as MembershipCandidate[])[0]??null}
export async function requireAdminPermission(permission:AdminPermission,options:{rateLimit?:boolean}={}):Promise<AuthorizedAdmin>{const correlationId=randomUUID(),identity=await verifyAdminIdentity();if(!identity)throw new AdminAuthorizationError("IDENTITY_REQUIRED",correlationId);if(identity.assurance!=="verified")throw new AdminAuthorizationError("MFA_REQUIRED",correlationId);const session=await resolveAdminSession(identity);if(!session)throw new AdminAuthorizationError("SESSION_REQUIRED",correlationId);const decision=evaluateAdminPolicy({membership:await findMembership(identity.identitySubject),permission,mfa:identity.assurance});if(!decision.allowed)throw new AdminAuthorizationError(decision.code,correlationId);if(options.rateLimit)await enforceAdminRateLimit({identitySubject:identity.identitySubject,operation:permission});return{identityProvider:"supabase_auth",identitySubject:identity.identitySubject,sessionId:session.id,membershipId:decision.membership.id,role:decision.membership.role as AdminRole,correlationId,actorReference:identity.displayName??"Administrador"}}
export async function requirePimAdmin():Promise<AuthorizedAdmin>{try{return await requireAdminPermission("pim.admin.read")}catch(error){if(error instanceof AdminAuthorizationError&&error.code==="IDENTITY_REQUIRED")redirect("/admin/login");if(error instanceof AdminAuthorizationError&&error.code==="MFA_REQUIRED")redirect("/admin/mfa");redirect("/admin/access-denied")}}
