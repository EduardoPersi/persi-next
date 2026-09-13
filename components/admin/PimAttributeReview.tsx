"use client";
import {useActionState,useState} from "react";
import {reviewAttribute,type PimActionState} from "@/app/admin/products/[id]/actions";

const initialState:PimActionState={ok:false};

export function PimAttributeReview({productId,attributeId,attributeName,cardinality,values}:{productId:string;attributeId:string;attributeName:string;cardinality:"single"|"multiple";values:Array<{attributeValueId:string;displayValue:string;reviewStatus:"approved"|"rejected"|null}>}){
 const [state,formAction,pending]=useActionState(reviewAttribute,initialState);
 const [confirming,setConfirming]=useState(false);
 const alreadyDecided=values.some(value=>value.reviewStatus!==null);
 const [approved,setApproved]=useState<Set<string>>(()=>new Set(values.filter(value=>value.reviewStatus==="approved").map(value=>value.attributeValueId)));

 const toggle=(id:string,checked:boolean)=>{
  setApproved(previous=>{
   if(cardinality==="single")return checked?new Set([id]):new Set();
   const next=new Set(previous);
   if(checked)next.add(id);else next.delete(id);
   return next;
  });
 };

 if(state.ok)return <p role="status" className="mt-2 text-sm font-semibold text-emerald-700">Decisão registrada.</p>;

 const actionLabel=alreadyDecided?"Alterar decisão":"Registrar decisão";

 if(!confirming)return <button type="button" onClick={()=>setConfirming(true)} className="mt-2 min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-heading hover:bg-background-soft">{actionLabel}</button>;

 return <form action={formAction} className="mt-2 rounded-lg border border-slate-300 bg-white p-3">
  <input type="hidden" name="productId" value={productId}/>
  <input type="hidden" name="attributeId" value={attributeId}/>
  {values.map(value=><input key={value.attributeValueId} type="hidden" name={approved.has(value.attributeValueId)?"approvedAttributeValueIds":"rejectedAttributeValueIds"} value={value.attributeValueId}/>)}
  <p className="text-sm font-semibold text-heading">{alreadyDecided?`Alterar valor aprovado para "${attributeName}"`:`Revisar valor de "${attributeName}"`}</p>
  <fieldset className="mt-2 space-y-2">
   <legend className="sr-only">Valor(es) aprovado(s) para {attributeName}</legend>
   {values.map(value=><label key={value.attributeValueId} className="flex items-center gap-2 text-sm font-medium">
     <input type={cardinality==="single"?"radio":"checkbox"} name={`select-${value.attributeValueId}`} checked={approved.has(value.attributeValueId)} onChange={(event)=>toggle(value.attributeValueId,event.target.checked)}/>
     {value.displayValue}
     {value.reviewStatus&&<span className="text-xs text-muted">(atualmente {value.reviewStatus==="approved"?"aprovado":"rejeitado"})</span>}
    </label>)}
  </fieldset>
  <label className="mt-3 block text-sm font-semibold">Justificativa técnica (obrigatória)
   <textarea name="reason" required minLength={10} maxLength={1000} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"/>
  </label>
  <div className="mt-3 flex flex-wrap gap-2">
   <button type="submit" disabled={pending||(cardinality==="single"&&approved.size!==1)} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60">{pending?"Salvando…":actionLabel}</button>
   <button type="button" onClick={()=>setConfirming(false)} className="min-h-11 rounded-lg border px-4 text-sm font-semibold">Cancelar</button>
  </div>
  {cardinality==="single"&&<p className="mt-1 text-xs text-muted">Este atributo aceita exatamente um valor aprovado.</p>}
  {state.error&&<p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>}
 </form>;
}
