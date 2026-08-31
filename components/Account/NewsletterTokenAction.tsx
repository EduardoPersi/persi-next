"use client";
import { useEffect,useState } from "react";
import { useRouter } from "next/navigation";
export function NewsletterTokenAction({token,action}:{token:string;action:"confirm"|"unsubscribe"}){
 const [message,setMessage]=useState("Processando sua solicitação...");const router=useRouter();
 useEffect(()=>{let active=true;(async()=>{try{const response=await fetch(`/api/newsletter/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token}),cache:"no-store"});const body=await response.json();if(active)setMessage(body.message);}catch{if(active)setMessage("Não foi possível concluir esta solicitação.");}finally{window.history.replaceState(null,"",action==="confirm"?"/confirmar-newsletter":"/cancelar-newsletter");router.refresh();}})();return()=>{active=false};},[action,router,token]);
 return <p role="status" className="rounded-xl bg-slate-50 p-5 text-center text-primary-hover">{message}</p>;
}
