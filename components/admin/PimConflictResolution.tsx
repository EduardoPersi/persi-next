"use client";
import {useActionState,useState} from "react";
import {resolveConflict,type PimActionState} from "@/app/admin/products/[id]/actions";

const initialState:PimActionState={ok:false};

export function PimConflictResolution({conflictId,attributeKey}:{conflictId:string;attributeKey:string}){
 const [state,formAction,pending]=useActionState(resolveConflict,initialState);
 const [confirming,setConfirming]=useState(false);

 if(state.ok)return <p role="status" className="mt-3 text-sm font-semibold text-emerald-700">Conflito marcado como resolvido.</p>;

 if(!confirming)return <button type="button" onClick={()=>setConfirming(true)} className="mt-3 min-h-11 rounded-lg border border-amber-400 px-4 text-sm font-semibold text-amber-950 hover:bg-amber-100">Marcar conflito como resolvido</button>;

 return <form action={formAction} className="mt-3 rounded-lg border border-amber-300 bg-white p-3">
  <input type="hidden" name="conflictId" value={conflictId}/>
  <p className="text-sm font-semibold text-amber-950">Confirmar resolução do conflito em &ldquo;{attributeKey}&rdquo;?</p>
  <p className="mt-1 text-xs text-muted">Resolver este conflito não aprova sugestão, não aprova o perfil editorial e não publica nada no site — apenas registra que ele foi analisado e considerado resolvido.</p>
  <label className="mt-2 block text-sm font-semibold">Justificativa técnica (obrigatória)
   <textarea name="reason" required minLength={10} maxLength={1000} rows={3} placeholder="Ex.: confirmado contra a ficha técnica oficial do fabricante." className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"/>
  </label>
  <div className="mt-3 flex flex-wrap gap-2">
   <button type="submit" disabled={pending} className="min-h-11 rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-60">{pending?"Confirmando…":"Confirmar resolução"}</button>
   <button type="button" onClick={()=>setConfirming(false)} className="min-h-11 rounded-lg border px-4 text-sm font-semibold">Cancelar</button>
  </div>
  {state.error&&<p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>}
 </form>;
}
