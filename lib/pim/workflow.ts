import "server-only";

import { sql } from "drizzle-orm";
import { getDatabase, type PersiDatabase } from "@/lib/db";
import {
  pimEditorialDraftSchema,
  pimWorkflowActionSchema,
  type PimEditorialDraftInput,
  type PimWorkflowActionInput,
} from "@/lib/validation/pimEditorial";

export type PimDecision = "approved" | "rejected";
type PimTransaction = Parameters<Parameters<PersiDatabase["transaction"]>[0]>[0];
type EditorialStatus = "raw"|"normalized"|"needs_enrichment"|"draft"|"ai_suggested"|"needs_review"|"approved"|"rejected"|"published";
type ProfileLock = { productId:string; workflowStatus:EditorialStatus; version:string; approvedContent:Record<string,unknown>|null; draft:Record<string,unknown> };

export class PimConcurrencyError extends Error {
  readonly code = "PIM_STALE_VERSION";
  constructor() { super("Este produto foi alterado desde que você abriu a página."); }
}

function requireActor(actorReference:string) {
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

async function audit(tx:PimTransaction,input:{productId:string;actor:string;operation:string;before:unknown;after:unknown;reason?:string}){
  await tx.execute(sql`insert into pim_audit_log(product_id,entity_type,entity_id,field_name,previous_value,new_value,source,actor_reference,operation,reason)
    values(${input.productId}::uuid,'editorial_profile',${input.productId}::uuid,'editorial_content',${JSON.stringify(input.before)},${JSON.stringify(input.after)},'manual',${input.actor},${input.operation},${input.reason??null})`);
}

export async function savePimEditorialDraft(raw:PimEditorialDraftInput,actorReference:string){
  const input=pimEditorialDraftSchema.parse(raw),actor=requireActor(actorReference),next=snapshot(input);
  return getDatabase().transaction(async(tx)=>{
    const profile=await lockProfile(tx,input.productId); assertVersion(profile,input.version);
    if(profile&&["needs_review","approved","rejected","published"].includes(profile.workflowStatus)) throw new Error("O estado atual exige uma ação de workflow antes da edição.");
    const operation=profile?"UPDATE_DRAFT":"CREATE_DRAFT";
    if(profile){
      await tx.execute(sql`update pim_product_profiles set workflow_status='draft',commercial_name=${input.commercialName},short_description=${input.shortDescription},
        description=${input.description},bullet_points=${input.bulletPoints},application=${input.application},specifications=${input.specifications},
        seo_title=${input.seoTitle},meta_description=${input.metaDescription},search_terms=${input.searchTerms},image_alt_text=${input.imageAltText},
        draft_started_at=coalesce(draft_started_at,now()),submitted_at=null,rejected_at=null,version=version+1 where product_id=${input.productId}::uuid`);
    }else{
      await tx.execute(sql`insert into pim_product_profiles(product_id,workflow_status,commercial_name,short_description,description,bullet_points,application,
        specifications,seo_title,meta_description,search_terms,image_alt_text,draft_started_at,version)
        values(${input.productId}::uuid,'draft',${input.commercialName},${input.shortDescription},${input.description},${input.bulletPoints},${input.application},
        ${input.specifications},${input.seoTitle},${input.metaDescription},${input.searchTerms},${input.imageAltText},now(),1)`);
    }
    await audit(tx,{productId:input.productId,actor,operation,before:profile?.draft??null,after:next});
    return {productId:input.productId,status:"draft" as const,version:input.version+BigInt(1)};
  });
}

export async function transitionPimEditorial(raw:PimWorkflowActionInput,actorReference:string){
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
      await tx.execute(sql`update pim_product_profiles set workflow_status='approved',approved_content=${JSON.stringify(profile.draft)}::jsonb,
        approved_at=now(),submitted_at=null,rejected_at=null,version=version+1 where product_id=${input.productId}::uuid`);
    }else if(input.action==="DISCARD_DRAFT"&&profile.approvedContent){
      const approved=profile.approvedContent;
      await tx.execute(sql`update pim_product_profiles set workflow_status='approved',
        commercial_name=${approved.commercialName??null},short_description=${approved.shortDescription??null},description=${approved.description??null},
        bullet_points=${Array.isArray(approved.bulletPoints)?approved.bulletPoints:[]},application=${approved.application??null},specifications=${approved.specifications??null},
        seo_title=${approved.seoTitle??null},meta_description=${approved.metaDescription??null},search_terms=${Array.isArray(approved.searchTerms)?approved.searchTerms:[]},
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
    await audit(tx,{productId:input.productId,actor,operation:input.action,before:{status:profile.workflowStatus,content:profile.draft},after:{status,content:after},reason:input.reason});
    return {productId:input.productId,status,version:input.version+BigInt(1)};
  });
}

export async function decidePimSuggestion(input:{suggestionId:string;decision:PimDecision;actorReference:string;reason?:string}){
  if(!/^[0-9a-f-]{36}$/i.test(input.suggestionId))throw new Error("Sugestão inválida.");
  const actor=requireActor(input.actorReference);
  return getDatabase().transaction(async(tx)=>{
    const locked=await tx.execute(sql`select id,product_id,field_name,suggested_value,status::text from pim_suggestions where id=${input.suggestionId}::uuid for update`);
    const suggestion=(locked as unknown as Array<{id:string;product_id:string;field_name:string;suggested_value:string;status:string}>)[0];
    if(!suggestion)throw new Error("Sugestão não encontrada.");
    if(suggestion.status!=="needs_review")throw new Error("Sugestão já revisada.");
    await tx.execute(sql`update pim_suggestions set status=${input.decision}::pim_decision_status,reviewed_by=${actor},reviewed_at=now() where id=${input.suggestionId}::uuid`);
    await tx.execute(sql`insert into pim_audit_log(product_id,entity_type,entity_id,field_name,previous_value,new_value,source,actor_reference,operation,reason)
      values(${suggestion.product_id}::uuid,'suggestion',${suggestion.id}::uuid,${suggestion.field_name},'needs_review',${input.decision},'manual',${actor},${`suggestion_${input.decision}`},${input.reason??null})`);
    return {productId:suggestion.product_id,decision:input.decision};
  });
}
