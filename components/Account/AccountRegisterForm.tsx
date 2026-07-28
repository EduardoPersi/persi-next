"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/UI/Button";
const input = "min-h-11 w-full rounded-xl border border-slate-300 px-3 focus:border-[#0c2d72] focus:outline-none focus:ring-2 focus:ring-[#0c2d72]/20";
export function AccountRegisterForm() {
  const [loading,setLoading]=useState(false); const [message,setMessage]=useState(""); const [success,setSuccess]=useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (loading) return; const data=new FormData(event.currentTarget);
    const payload={name:String(data.get("name")??""),email:String(data.get("email")??""),phone:String(data.get("phone")??""),cpf:"",password:String(data.get("password")??""),passwordConfirmation:String(data.get("passwordConfirmation")??""),acceptTerms:data.get("acceptTerms")==="on"};
    setLoading(true); setMessage("");
    try { const response=await fetch("/api/account/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); const body=await response.json(); if(!response.ok) throw new Error(body.message); setSuccess(true); }
    catch(error){setMessage(error instanceof Error?error.message:"Não foi possível criar a conta agora.");} finally{setLoading(false);}
  }
  if(success) return <div role="status" className="rounded-xl bg-green-50 p-5 text-green-900"><p className="font-semibold">Conta criada com sucesso.</p><Link href="/entrar" className="mt-4 inline-block font-semibold underline">Entrar na minha conta</Link></div>;
  return <form onSubmit={submit} className="space-y-5" noValidate>
    <div><label htmlFor="register-name" className="mb-2 block font-medium">Nome completo</label><input id="register-name" name="name" autoComplete="name" required minLength={3} className={input}/></div>
    <div><label htmlFor="register-email" className="mb-2 block font-medium">E-mail</label><input id="register-email" name="email" type="email" autoComplete="email" required className={input}/></div>
    <div><label htmlFor="register-phone" className="mb-2 block font-medium">Telefone <span className="font-normal text-slate-500">(opcional)</span></label><input id="register-phone" name="phone" type="tel" autoComplete="tel" className={input}/></div>
    <div><label htmlFor="register-password" className="mb-2 block font-medium">Senha</label><input id="register-password" name="password" type="password" autoComplete="new-password" required minLength={8} className={input}/><p className="mt-1 text-sm text-slate-500">Use pelo menos 8 caracteres.</p></div>
    <div><label htmlFor="register-confirm" className="mb-2 block font-medium">Confirmar senha</label><input id="register-confirm" name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={8} className={input}/></div>
    <label className="flex items-start gap-3 text-sm"><input name="acceptTerms" type="checkbox" required className="mt-1 h-4 w-4 accent-[#0c2d72]"/><span>Li e aceito os termos e a política de privacidade.</span></label>
    {message&&<p role="alert" className="text-sm text-red-700">{message}</p>}
    <Button type="submit" className="w-full" disabled={loading}>{loading?"Criando conta...":"Criar minha conta"}</Button>
  </form>;
}
