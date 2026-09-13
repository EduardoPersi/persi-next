"use client";
import {useActionState,useState} from "react";
import {decideConflictAttribute,type PimActionState} from "@/app/admin/products/[id]/actions";

const initialState:PimActionState={ok:false};

export function PimConflictAttributeDecision({conflictId,attributeName,candidates}:{conflictId:string;attributeName:string;candidates:Array<{attributeValueId:string;displayValue:string}>}){
 const [state,formAction,pending]=useActionState(decideConflictAttribute,initialState);
 const [confirming,setConfirming]=useState(false);
 const [selected,setSelected]=useState<string>("");

 if(state.ok)return <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">Valor confirmado e conflito resolvido.</p>;

 if(!confirming)return <button type="button" onClick={()=>setConfirming(true)} className="mt-3 min-h-11 rounded-lg border border-amber-400 px-4 text-sm font-semibold text-amber-950 hover:bg-amber-100">Confirmar valor e resolver conflito</button>;

 return <form action={formAction} className="mt-3 rounded-lg border border-amber-300 bg-white p-3">
  <input type="hidden" name="conflictId" value={conflictId}/>
  <p className="text-sm font-semibold text-amber-950">Escolha o valor que ficará aprovado no PIM para &ldquo;{attributeName}&rdquo;.</p>
  <p className="mt-1 text-xs text-muted">Resolver este conflito não aprova sugestão, não aprova o perfil editorial e não publica nada no site — apenas registra qual valor é o correto para este atributo.</p>
  <fieldset className="mt-3 space-y-2">
   <legend className="sr-only">Valor correto para {attributeName}</legend>
   {candidates.map(candidate=><label key={candidate.attributeValueId} className="flex items-center gap-2 text-sm font-medium">
     <input type="radio" name="attributeValueId" value={candidate.attributeValueId} required checked={selected===candidate.attributeValueId} onChange={()=>setSelected(candidate.attributeValueId)}/>
     {candidate.displayValue}
    </label>)}
  </fieldset>
  <label className="mt-3 block text-sm font-semibold">Justificativa técnica (obrigatória)
   <textarea name="reason" required minLength={10} maxLength={1000} rows={3} placeholder="Ex.: confirmado contra a ficha técnica oficial do fabricante." className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"/>
  </label>
  <div className="mt-3 flex flex-wrap gap-2">
   <button type="submit" disabled={pending||!selected} className="min-h-11 rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{pending?"Confirmando…":"Confirmar valor e resolver conflito"}</button>
   <button type="button" onClick={()=>setConfirming(false)} className="min-h-11 rounded-lg border px-4 text-sm font-semibold">Cancelar</button>
  </div>
  {state.error&&<p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>}
 </form>;
}
