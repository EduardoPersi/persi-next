import {isAdminRole,roleHasPermission,type AdminPermission} from "./permissions";
export type MembershipCandidate={id:string;identityProvider:string;identitySubject:string;role:string;status:string;revokedAt:Date|null};
export type MfaAssurance="verified"|"not_verified"|"unknown";
export function evaluateAdminPolicy(input:{membership:MembershipCandidate|null;permission:AdminPermission;mfa:MfaAssurance}){
 const m=input.membership;
 if(!m)return {allowed:false as const,code:"MEMBERSHIP_REQUIRED"};
 if(m.status!=="active"||m.revokedAt)return {allowed:false as const,code:"MEMBERSHIP_INACTIVE"};
 if(!isAdminRole(m.role))return {allowed:false as const,code:"ROLE_INVALID"};
 if(!roleHasPermission(m.role,input.permission))return {allowed:false as const,code:"PERMISSION_DENIED"};
 if(input.mfa!=="verified")return {allowed:false as const,code:"MFA_REQUIRED"};
 return {allowed:true as const,membership:m};
}
