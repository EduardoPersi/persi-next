import "server-only";

import { sql } from "drizzle-orm";
import { getDatabase, type PersiDatabase } from "@/lib/db";
import {
  pimEditorialDraftSchema,
  pimWorkflowActionSchema,
  pimConflictResolutionSchema,
  pimConflictAttributeDecisionSchema,
  type PimEditorialDraftInput,
  type PimWorkflowActionInput,
  type PimConflictResolutionInput,
  type PimConflictAttributeDecisionInput,
} from "@/lib/validation/pimEditorial";
import {assertProfileApprovalAllowed,assertSuggestionDecisionAllowed} from "@/lib/pim/conflict-policy";
import {findConflictAttributeCandidates} from "@/lib/pim/attribute-conflict";

export type PimDecision = "approved" | "rejected";
export type PimAdminAuditContext={identityProvider:string;identitySubject:string;adminSessionId:string;membershipId:string;effectiveRole:string;correlationId:string};
type PimTransaction = Parameters<Parameters<PersiDatabase["transaction"]>[0]>[0];
type EditorialStatus = "raw"|"normalized"|"needs_enrichment"|"draft"|"ai_suggested"|"needs_review"|"approved"|"rejected"|"published";
type ProfileLock = { productId:string; workflowStatus:EditorialStatus; version:string; approvedContent:Record<string,unknown>|null; draft:Record<string,unknown> };

export class PimConcurrencyError extends Error {
  readonly code = "PIM_STALE_VERSION";
  constructor() { super("Este produto foi alterado desde que você abriu a página."); }
}

export class PimConflictAlreadyResolvedError extends Error {
  readonly code = "PIM_CONFLICT_ALREADY_RESOLVED";
  constructor() { super("Este conflito já foi resolvido por outra pessoa."); }
}

export class PimConflictNotFoundError extends Error {
  readonly code = "PIM_CONFLICT_NOT_FOUND";
  constructor() { super("Conflito não encontrado."); }
}

export class PimConflictInvalidValueError extends Error {
  readonly code = "PIM_CONFLICT_INVALID_VALUE";
  constructor() { super("O valor selecionado não corresponde às evidências deste conflito. Atualize a página."); }
}

export function requireActor(actorReference:string) {
  const actor=actorReference.trim();
  if(!actor || actor.length>200) throw new Error("Ator administrativo inválido.");
  return actor;
}

function snapshot(input:PimEditorialDraftInput) {
  return {
    commercialName:input.commercialName, shortDescription:input.shortDescription, description:input.description,
    bulletPoints:input.bulletPoints, application:input.application, specifications:input.specifications,
    seoTitle:input.seoTitle, metaDescription:input.metaDescription, searchTerms:input.searchTerms,
    imageAltText:input.imageAltText,
  };
}

function textArray(values:string[]){
  return sql`array[${sql.join(values.map(value=>sql`${value}`),sql`, `)}]::text[]`;
}

async function lockProfile(tx:PimTransaction,productId:string):Promise<ProfileLock|null>{
  const rows=await tx.execute(sql`select product_id "productId",workflow_status::text "workflowStatus",version::text version,approved_content "approvedContent",
    jsonb_build_object('commercialName',commercial_name,'shortDescription',short_description,'description',description,
      'bulletPoints',bullet_points,'application',application,'specifications',specifications,'seoTitle',seo_title,
      'metaDescription',meta_description,'searchTerms',search_terms,'imageAltText',image_alt_text) draft
    from pim_product_profiles where product_id=${productId}::uuid for update`);
  return (rows as unknown as ProfileLock[])[0]??null;
}

function assertVersion(profile:ProfileLock|null,expected:bigint){
  if(BigInt(profile?.version??"0")!==expected) throw new PimConcurrencyError();
}

async function audit(tx:PimTransaction,input:{productId:string;actor:string;operation:string;before:unknown;after:unknown;reason?:string;context?:PimAdminAuditContext}){
  await tx.execute(sql`insert into pim_audit_log(product_id,entity_type,entity_id,field_name,previous_value,new_value,source,actor_reference,operation,reason,actor_identity_provider,actor_identity_subject,admin_session_id,admin_membership_id,effective_role,correlation_id)
    values(${input.productId}::uuid,'editorial_profile',${input.productId}::uuid,'editorial_content',${JSON.stringify(input.before)},${JSON.stringify(input.after)},'manual',${input.actor},${input.operation},${input.reason??null},${input.context?.identityProvider??null},${input.context?.identitySubject??null},${input.context?.adminSessionId??null}::uuid,${input.context?.membershipId??null}::uuid,${input.context?.effectiveRole??null},${input.context?.correlationId??null}::uuid)`);
}

export async function savePimEditorialDraft(raw:PimEditorialDraftInput,actorReference:string,context?:PimAdminAuditContext){
  const input=pimEditorialDraftSchema.parse(raw),actor=requireActor(actorReference),next=snapshot(input);
  return getDatabase().transaction(async(tx)=>{
    const profile=await lockProfile(tx,input.productId); assertVersion(profile,input.version);
    if(profile&&["needs_review","approved","rejected","published"].includes(profile.workflowStatus)) throw new Error("O estado atual exige uma ação de workflow antes da edição.");
    const operation=profile?"UPDATE_DRAFT":"CREATE_DRAFT";
    if(profile){
      await tx.execute(sql`update pim_product_profiles set workflow_status='draft',commercial_name=${input.commercialName},short_description=${input.shortDescription},
        description=${input.description},bullet_points=${textArray(input.bulletPoints)},application=${input.application},specifications=${input.specifications},
        seo_title=${input.seoTitle},meta_description=${input.metaDescription},search_terms=${textArray(input.searchTerms)},image_alt_text=${input.imageAltText},
        draft_started_at=coalesce(draft_started_at,now()),submitted_at=null,rejected_at=null,version=version+1 where product_id=${input.productId}::uuid`);
    }else{
      await tx.execute(sql`insert into pim_product_profiles(product_id,workflow_status,commercial_name,short_description,description,bullet_points,application,
        specifications,seo_title,meta_description,search_terms,image_alt_text,draft_started_at,version)
        values(${input.productId}::uuid,'draft',${input.commercialName},${input.shortDescription},${input.description},${textArray(input.bulletPoints)},${input.application},
        ${input.specifications},${input.seoTitle},${input.metaDescription},${textArray(input.searchTerms)},${input.imageAltText},now(),1)`);
    }
    await audit(tx,{productId:input.productId,actor,operation,before:profile?.draft??null,after:next,context});
    return {productId:input.productId,status:"draft" as const,version:input.version+BigInt(1)};
  });
}

export async function transitionPimEditorial(raw:PimWorkflowActionInput,actorReference:string,context?:PimAdminAuditContext){
  const input=pimWorkflowActionSchema.parse(raw),actor=requireActor(actorReference);
  return getDatabase().transaction(async(tx)=>{
    const profile=await lockProfile(tx,input.productId); if(!profile) throw new Error("Perfil editorial não encontrado."); assertVersion(profile,input.version);
    let status:EditorialStatus=profile.workflowStatus,after:unknown=profile.draft;
    if(input.action==="SUBMIT_REVIEW"&&status==="draft") status="needs_review";
    else if(input.action==="APPROVE"&&status==="needs_review") status="approved";
    else if(input.action==="REJECT"&&status==="needs_review") status="rejected";
    else if(input.action==="REOPEN"&&(status==="approved"||status==="rejected")) status="draft";
    else if(input.action==="DISCARD_DRAFT"&&status==="draft") status=profile.approvedContent?"approved":"needs_enrichment";
    else throw new Error(`Transição ${input.action} inválida para ${profile.workflowStatus}.`);

    if(input.action==="APPROVE"){
      const blocking=await tx.execute(sql`select count(*)::int count from pim_suggestions where product_id=${input.productId}::uuid and superseded_at is null and status in ('needs_review','approved') and (payload @> '{"editorialBlockedByConflict":true}'::jsonb or payload @> '{"acceptableForDraft":false}'::jsonb or case when jsonb_typeof(payload->'blockingConflicts')='array' then jsonb_array_length(payload->'blockingConflicts')>0 else false end)`);
      assertProfileApprovalAllowed(Number((blocking as unknown as Array<{count:number}>)[0]?.count??0));
      await tx.execute(sql`update pim_product_profiles set workflow_status='approved',approved_content=${JSON.stringify(profile.draft)}::jsonb,
        approved_at=now(),submitted_at=null,rejected_at=null,version=version+1 where product_id=${input.productId}::uuid`);
    }else if(input.action==="DISCARD_DRAFT"&&profile.approvedContent){
      const approved=profile.approvedContent;
      await tx.execute(sql`update pim_product_profiles set workflow_status='approved',
        commercial_name=${approved.commercialName??null},short_description=${approved.shortDescription??null},description=${approved.description??null},
        bullet_points=${textArray(Array.isArray(approved.bulletPoints)?approved.bulletPoints as string[]:[])},application=${approved.application??null},specifications=${approved.specifications??null},
        seo_title=${approved.seoTitle??null},meta_description=${approved.metaDescription??null},search_terms=${textArray(Array.isArray(approved.searchTerms)?approved.searchTerms as string[]:[])},
        image_alt_text=${approved.imageAltText??null},draft_started_at=null,submitted_at=null,rejected_at=null,version=version+1 where product_id=${input.productId}::uuid`);
      after=approved;
    }else if(input.action==="DISCARD_DRAFT"){
      await tx.execute(sql`update pim_product_profiles set workflow_status='needs_enrichment',commercial_name=null,short_description=null,description=null,
        bullet_points='{}',application=null,specifications=null,seo_title=null,meta_description=null,search_terms='{}',image_alt_text=null,
        draft_started_at=null,submitted_at=null,rejected_at=null,version=version+1 where product_id=${input.productId}::uuid`);
      after=null;
    }else{
      await tx.execute(sql`update pim_product_profiles set workflow_status=${status}::pim_workflow_status,
        submitted_at=case when ${input.action}='SUBMIT_REVIEW' then now() else submitted_at end,
        rejected_at=case when ${input.action}='REJECT' then now() else null end,
        draft_started_at=case when ${input.action}='REOPEN' then now() else draft_started_at end,
        version=version+1 where product_id=${input.productId}::uuid`);
    }
    await audit(tx,{productId:input.productId,actor,operation:input.action,before:{status:profile.workflowStatus,content:profile.draft},after:{status,content:after},reason:input.reason,context});
    return {productId:input.productId,status,version:input.version+BigInt(1)};
  });
}

export async function decidePimSuggestion(input:{suggestionId:string;decision:PimDecision;actorReference:string;reason?:string;auditContext?:PimAdminAuditContext}){
  if(!/^[0-9a-f-]{36}$/i.test(input.suggestionId))throw new Error("Sugestão inválida.");
  const actor=requireActor(input.actorReference);
  return getDatabase().transaction(async(tx)=>{
    const locked=await tx.execute(sql`select id,product_id,field_name,suggested_value,status::text,superseded_at,payload from pim_suggestions where id=${input.suggestionId}::uuid for update`);
    const suggestion=(locked as unknown as Array<{id:string;product_id:string;field_name:string;suggested_value:string;status:string;superseded_at:Date|null;payload:Record<string,unknown>}>)[0];
    if(!suggestion)throw new Error("Sugestão não encontrada.");
    if(suggestion.status!=="needs_review")throw new Error("Sugestão já revisada.");
    if(suggestion.superseded_at)throw new Error("Sugestão substituída por uma versão mais recente.");
    assertSuggestionDecisionAllowed(suggestion.payload,input.decision);
    if(input.decision==="approved"&&["commercialName","commercial_name","shortDescription","short_description","description","application","specifications","seoTitle","seo_title","metaDescription","meta_description","imageAltText","image_alt_text"].includes(suggestion.field_name)){
      await tx.execute(sql`insert into pim_product_profiles(product_id,workflow_status,draft_started_at,version) values(${suggestion.product_id}::uuid,'draft',now(),0) on conflict(product_id) do nothing`);
      await tx.execute(sql`update pim_product_profiles set workflow_status='draft',draft_started_at=coalesce(draft_started_at,now()),commercial_name=case when ${suggestion.field_name} in ('commercialName','commercial_name') then ${suggestion.suggested_value} else commercial_name end,short_description=case when ${suggestion.field_name} in ('shortDescription','short_description') then ${suggestion.suggested_value} else short_description end,description=case when ${suggestion.field_name}='description' then ${suggestion.suggested_value} else description end,application=case when ${suggestion.field_name}='application' then ${suggestion.suggested_value} else application end,specifications=case when ${suggestion.field_name}='specifications' then ${suggestion.suggested_value} else specifications end,seo_title=case when ${suggestion.field_name} in ('seoTitle','seo_title') then ${suggestion.suggested_value} else seo_title end,meta_description=case when ${suggestion.field_name} in ('metaDescription','meta_description') then ${suggestion.suggested_value} else meta_description end,image_alt_text=case when ${suggestion.field_name} in ('imageAltText','image_alt_text') then ${suggestion.suggested_value} else image_alt_text end,version=version+1 where product_id=${suggestion.product_id}::uuid`);
    }
    await tx.execute(sql`update pim_suggestions set status=${input.decision}::pim_decision_status,reviewed_by=${actor},reviewed_at=now() where id=${input.suggestionId}::uuid`);
    await tx.execute(sql`insert into pim_audit_log(product_id,entity_type,entity_id,field_name,previous_value,new_value,source,actor_reference,operation,reason,actor_identity_provider,actor_identity_subject,admin_session_id,admin_membership_id,effective_role,correlation_id)
      values(${suggestion.product_id}::uuid,'suggestion',${suggestion.id}::uuid,${suggestion.field_name},'needs_review',${input.decision},'manual',${actor},${`suggestion_${input.decision}`},${input.reason??null},${input.auditContext?.identityProvider??null},${input.auditContext?.identitySubject??null},${input.auditContext?.adminSessionId??null}::uuid,${input.auditContext?.membershipId??null}::uuid,${input.auditContext?.effectiveRole??null},${input.auditContext?.correlationId??null}::uuid)`);
    return {productId:suggestion.product_id,decision:input.decision};
  });
}

// Resolves a public.pim_conflicts row only. It never touches pim_suggestions or
// pim_product_profiles: the payload-level blocking flags checked by
// assertSuggestionDecisionAllowed/assertProfileApprovalAllowed are a separate,
// independent gate that this operation does not read or affect.
export async function resolvePimConflict(raw:PimConflictResolutionInput,actorReference:string,context?:PimAdminAuditContext){
  const input=pimConflictResolutionSchema.parse(raw),actor=requireActor(actorReference);
  return getDatabase().transaction(async(tx)=>{
    const locked=await tx.execute(sql`select id,product_id,attribute_key,status from pim_conflicts where id=${input.conflictId}::uuid for update`);
    const conflict=(locked as unknown as Array<{id:string;product_id:string;attribute_key:string;status:string}>)[0];
    if(!conflict)throw new PimConflictNotFoundError();
    if(conflict.status!=="open")throw new PimConflictAlreadyResolvedError();
    const updated=await tx.execute(sql`update pim_conflicts set status='resolved',resolved_at=now(),resolved_by=${actor}
      where id=${input.conflictId}::uuid and status='open' returning id`);
    if((updated as unknown as Array<{id:string}>).length!==1)throw new PimConflictAlreadyResolvedError();
    await tx.execute(sql`insert into pim_audit_log(product_id,entity_type,entity_id,field_name,previous_value,new_value,source,actor_reference,operation,reason,actor_identity_provider,actor_identity_subject,admin_session_id,admin_membership_id,effective_role,correlation_id)
      values(${conflict.product_id}::uuid,'conflict',${conflict.id}::uuid,${conflict.attribute_key},'open','resolved','manual',${actor},'CONFLICT_RESOLVED',${input.reason},${context?.identityProvider??null},${context?.identitySubject??null},${context?.adminSessionId??null}::uuid,${context?.membershipId??null}::uuid,${context?.effectiveRole??null},${context?.correlationId??null}::uuid)`);
    return {conflictId:conflict.id,productId:conflict.product_id,status:"resolved" as const};
  });
}

// Semantic variant of resolvePimConflict for conflicts that correspond to a
// structured attribute with two or more competing product_attribute_values
// candidates (e.g. two sources each assigning a different single-value
// color). Recording status='resolved' alone is not enough in that case: the
// UI must stop showing every competing value as "Aprovado no PIM". This
// records the human decision in public.pim_attribute_reviews — the table
// already designed for exactly this — instead of deleting or overwriting
// product_attribute_values, so every candidate and its evidence stays
// intact and queryable.
export async function decidePimConflictAttribute(raw:PimConflictAttributeDecisionInput,actorReference:string,context?:PimAdminAuditContext){
  const input=pimConflictAttributeDecisionSchema.parse(raw),actor=requireActor(actorReference);
  return getDatabase().transaction(async(tx)=>{
    const locked=await tx.execute(sql`select id,product_id,attribute_key,status from pim_conflicts where id=${input.conflictId}::uuid for update`);
    const conflict=(locked as unknown as Array<{id:string;product_id:string;attribute_key:string;status:string}>)[0];
    if(!conflict)throw new PimConflictNotFoundError();
    if(conflict.status!=="open")throw new PimConflictAlreadyResolvedError();

    const match=await findConflictAttributeCandidates(tx,conflict.product_id,conflict.attribute_key);
    if(!match||match.candidates.length<2)throw new PimConflictInvalidValueError();
    const chosen=match.candidates.find(candidate=>candidate.attributeValueId===input.attributeValueId);
    if(!chosen)throw new PimConflictInvalidValueError();

    for(const candidate of match.candidates){
      const approved=candidate.attributeValueId===input.attributeValueId;
      await tx.execute(sql`insert into pim_attribute_reviews(product_id,attribute_id,attribute_value_id,source,status,reviewed_by,reviewed_at)
        values(${conflict.product_id}::uuid,${match.attributeId}::uuid,${candidate.attributeValueId}::uuid,'manual',${approved?"approved":"rejected"},${actor},now())
        on conflict(product_id,attribute_id,attribute_value_id) do update set status=excluded.status,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at,updated_at=now()`);
    }

    const updated=await tx.execute(sql`update pim_conflicts set status='resolved',resolved_at=now(),resolved_by=${actor}
      where id=${input.conflictId}::uuid and status='open' returning id`);
    if((updated as unknown as Array<{id:string}>).length!==1)throw new PimConflictAlreadyResolvedError();

    const alternatives=match.candidates.map(candidate=>candidate.displayValue);
    await tx.execute(sql`insert into pim_audit_log(product_id,entity_type,entity_id,field_name,previous_value,new_value,source,actor_reference,operation,reason,actor_identity_provider,actor_identity_subject,admin_session_id,admin_membership_id,effective_role,correlation_id)
      values(${conflict.product_id}::uuid,'conflict',${conflict.id}::uuid,${conflict.attribute_key},${JSON.stringify(alternatives)},${chosen.displayValue},'manual',${actor},'CONFLICT_ATTRIBUTE_DECIDED',${input.reason},${context?.identityProvider??null},${context?.identitySubject??null},${context?.adminSessionId??null}::uuid,${context?.membershipId??null}::uuid,${context?.effectiveRole??null},${context?.correlationId??null}::uuid)`);

    return {conflictId:conflict.id,productId:conflict.product_id,attributeId:match.attributeId,chosenAttributeValueId:chosen.attributeValueId,status:"resolved" as const};
  });
}
