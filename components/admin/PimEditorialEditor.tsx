"use client";

import { useActionState } from "react";
import { runEditorialWorkflow, saveEditorialDraft, type PimActionState } from "@/app/admin/products/[id]/actions";
import type { PimEditorialContent, PimStatus } from "@/lib/pim/repository";

const initialState:PimActionState={ok:false};
const fieldClass="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2";
const labels:Record<string,string>={commercialName:"Nome comercial",shortDescription:"Descrição curta",description:"Descrição completa",bulletPoints:"Bullet points",application:"Aplicação",specifications:"Especificações",seoTitle:"SEO title",metaDescription:"Meta description",searchTerms:"Termos de busca",imageAltText:"Alt da imagem"};

function value(content:PimEditorialContent|null,key:keyof PimEditorialContent){const current=content?.[key];return Array.isArray(current)?current.join("\n"):current??"";}
function ReadColumn({title,content,fallback}:{title:string;content:PimEditorialContent|null;fallback?:Partial<PimEditorialContent>}){
  return <section className="rounded-xl border bg-slate-50 p-4"><h3 className="font-bold text-[#071f5c]">{title}</h3><dl className="mt-3 space-y-3 text-sm">{(Object.keys(labels) as Array<keyof PimEditorialContent>).map(key=><div key={key}><dt className="font-semibold text-slate-500">{labels[key]}</dt><dd className="whitespace-pre-wrap">{value(content,key)||value(fallback as PimEditorialContent,key)||"—"}</dd></div>)}</dl></section>;
}

export function PimEditorialEditor({productId,version,status,source,draft,approved}:{productId:string;version:string;status:PimStatus;source:Partial<PimEditorialContent>;draft:PimEditorialContent;approved:PimEditorialContent|null}){
  const [saveState,saveAction,savePending]=useActionState(saveEditorialDraft,initialState);
  const [workflowState,workflowAction,workflowPending]=useActionState(runEditorialWorkflow,initialState);
  const editable=["raw","normalized","needs_enrichment","draft","ai_suggested"].includes(status);
  const actions=status==="draft"?[["SUBMIT_REVIEW","Enviar para revisão"],["DISCARD_DRAFT","Descartar alterações"]]:status==="needs_review"?[["APPROVE","Aprovar"],["REJECT","Rejeitar"]]:status==="approved"||status==="rejected"?[["REOPEN","Criar nova edição"]]:[];
  return <div className="mt-4 space-y-4">
    <div className="grid gap-4 xl:grid-cols-3">
      <ReadColumn title="ORIGINAL" content={null} fallback={source}/>
      <form action={saveAction} className="rounded-xl border border-blue-200 bg-white p-4">
        <h3 className="font-bold text-[#071f5c]">DRAFT</h3><input type="hidden" name="productId" value={productId}/><input type="hidden" name="version" value={version}/>
        <div className="mt-3 space-y-3">{(Object.keys(labels) as Array<keyof PimEditorialContent>).map(key=>{const changed=value(draft,key)!==value((approved??source) as PimEditorialContent,key);const multiline=key!=="commercialName"&&key!=="seoTitle"&&key!=="imageAltText";return <label key={key} className="block text-sm font-semibold">{labels[key]} {changed&&<span className="ml-1 text-xs text-[#ff6a00]">Alterado</span>}{multiline?<textarea name={key} defaultValue={value(draft,key)} disabled={!editable} rows={key==="description"?6:3} className={fieldClass}/>:<input name={key} defaultValue={value(draft,key)} disabled={!editable} className={fieldClass}/>}</label>})}</div>
        {editable&&<button disabled={savePending} className="mt-4 rounded-xl bg-[#0c2d72] px-4 py-2 font-semibold text-white disabled:opacity-60">{savePending?"Salvando…":"Salvar rascunho"}</button>}
        {saveState.error&&<p role="alert" className="mt-3 text-sm text-red-700">{saveState.error}</p>}{saveState.ok&&<p role="status" className="mt-3 text-sm text-emerald-700">Rascunho salvo.</p>}
      </form>
      <ReadColumn title="APPROVED" content={approved}/>
    </div>
    {actions.length>0&&<form action={workflowAction} className="rounded-xl border bg-white p-4"><input type="hidden" name="productId" value={productId}/><input type="hidden" name="version" value={version}/><label className="block text-sm font-semibold">Motivo (opcional)<input name="reason" maxLength={1000} className={fieldClass}/></label><div className="mt-3 flex flex-wrap gap-2">{actions.map(([action,label])=><button key={action} name="action" value={action} disabled={workflowPending} className="rounded-xl border border-[#0c2d72] px-4 py-2 font-semibold text-[#0c2d72] disabled:opacity-60">{label}</button>)}</div>{workflowState.error&&<p role="alert" className="mt-3 text-sm text-red-700">{workflowState.error}</p>}</form>}
  </div>;
}
