"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/UI/Button";
import { EmailAutocompleteInput } from "@/components/UI/EmailAutocompleteInput";
export function AccountForgotPasswordForm() {
  const [loading,setLoading]=useState(false); const [message,setMessage]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(loading)return;const data=new FormData(event.currentTarget);setLoading(true);try{const response=await fetch("/api/account/forgot-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:String(data.get("email")??"")})});const body=await response.json();setMessage(body.message);}finally{setLoading(false);}}
  return <form onSubmit={submit} className="space-y-5"><div><label htmlFor="forgot-email" className="mb-2 block font-medium">E-mail</label><EmailAutocompleteInput id="forgot-email" name="email" autoComplete="email" required className="min-h-11 w-full rounded-xl border border-slate-300 px-3 focus:border-[#0c2d72] focus:outline-none focus:ring-2 focus:ring-[#0c2d72]/20"/></div>{message&&<p role="status" className="rounded-xl bg-blue-50 p-4 text-[#071f5c]">{message}</p>}<Button type="submit" className="w-full" disabled={loading}>{loading?"Enviando...":"Enviar instruções"}</Button></form>;
}
