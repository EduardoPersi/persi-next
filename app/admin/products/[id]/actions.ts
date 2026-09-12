"use server";
import {revalidatePath} from "next/cache";
import {AdminAuthorizationError,requireAdminPermission,type AuthorizedAdmin} from "@/lib/admin/authorization";
import {permissionForWorkflowAction} from "@/lib/admin/permissions";
import {decidePimSuggestion,PimConcurrencyError,savePimEditorialDraft,transitionPimEditorial,type PimDecision,type PimAdminAuditContext} from "@/lib/pim/workflow";

export type PimActionState={ok:boolean;code?:string;error?:string;correlationId?:string};
const list=(value:FormDataEntryValue|null)=>String(value??"").split(/\r?\n/).map(item=>item.trim()).filter(Boolean);
const auditContext=(admin:AuthorizedAdmin):PimAdminAuditContext=>({identityProvider:admin.identityProvider,identitySubject:admin.identitySubject,adminSessionId:admin.sessionId,membershipId:admin.membershipId,effectiveRole:admin.role,correlationId:admin.correlationId});
function safeFailure(error:unknown):PimActionState{const correlationId=error instanceof AdminAuthorizationError?error.correlationId:crypto.randomUUID(),code=error instanceof AdminAuthorizationError?error.code:error instanceof PimConcurrencyError?error.code:"PIM_MUTATION_FAILED";console.error("PIM_ADMIN_MUTATION_FAILED",{correlationId,code});return{ok:false,code,error:error instanceof PimConcurrencyError?"Este produto foi alterado. Atualize a página e tente novamente.":"Não foi possível concluir a operação.",correlationId}}

export async function saveEditorialDraft(_state:PimActionState,formData:FormData):Promise<PimActionState>{
 try{const admin=await requireAdminPermission("pim.draft.edit",{rateLimit:true}),productId=String(formData.get("productId")??"");await savePimEditorialDraft({productId,version:BigInt(String(formData.get("version")??"0")),commercialName:String(formData.get("commercialName")??""),shortDescription:String(formData.get("shortDescription")??""),description:String(formData.get("description")??""),bulletPoints:list(formData.get("bulletPoints")),application:String(formData.get("application")??""),specifications:String(formData.get("specifications")??""),seoTitle:String(formData.get("seoTitle")??""),metaDescription:String(formData.get("metaDescription")??""),searchTerms:list(formData.get("searchTerms")),imageAltText:String(formData.get("imageAltText")??"")},admin.actorReference,auditContext(admin));revalidatePath(`/admin/products/${productId}`);revalidatePath("/admin/products");revalidatePath("/admin/pim");return{ok:true,correlationId:admin.correlationId}}catch(error){return safeFailure(error)}
}
export async function runEditorialWorkflow(_state:PimActionState,formData:FormData):Promise<PimActionState>{
 try{const action=String(formData.get("action")??""),permission=permissionForWorkflowAction(action);if(!permission)throw new AdminAuthorizationError("UNKNOWN_WORKFLOW_ACTION",crypto.randomUUID());const admin=await requireAdminPermission(permission,{rateLimit:true}),productId=String(formData.get("productId")??"");await transitionPimEditorial({productId,version:BigInt(String(formData.get("version")??"0")),action:action as "SUBMIT_REVIEW",reason:String(formData.get("reason")??"")||undefined},admin.actorReference,auditContext(admin));revalidatePath(`/admin/products/${productId}`);revalidatePath("/admin/products");revalidatePath("/admin/pim");return{ok:true,correlationId:admin.correlationId}}catch(error){return safeFailure(error)}
}
export async function reviewSuggestion(formData:FormData){
 const decision=String(formData.get("decision")??"") as PimDecision;if(decision!=="approved"&&decision!=="rejected")throw new AdminAuthorizationError("INVALID_DECISION",crypto.randomUUID());
 try{const admin=await requireAdminPermission("pim.suggestion.review",{rateLimit:true}),result=await decidePimSuggestion({suggestionId:String(formData.get("suggestionId")??""),decision,actorReference:admin.actorReference,auditContext:auditContext(admin)});revalidatePath(`/admin/products/${result.productId}`);revalidatePath("/admin/products");revalidatePath("/admin/pim")}catch(error){const failure=safeFailure(error);throw new Error(`${failure.code}:${failure.correlationId}`)}
}
