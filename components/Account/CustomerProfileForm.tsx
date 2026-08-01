"use client";

import { useState, type FormEvent } from "react";
import type { CustomerWorkspaceProfile } from "@/lib/customer-workspace/types";
import { Button } from "@/components/UI/Button";

export function CustomerProfileForm({ initialProfile }: { initialProfile: CustomerWorkspaceProfile }) {
  const [profile, setProfile] = useState(initialProfile);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/account/workspace/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...profile, displayName: undefined, email: undefined, currentPassword, newPassword }) });
      const body = await response.json() as CustomerWorkspaceProfile & { message?: string };
      if (!response.ok) throw new Error(body.message || "Não foi possível salvar seus dados.");
      setProfile(body); setCurrentPassword(""); setNewPassword(""); setMessage("Dados atualizados com sucesso.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar seus dados."); }
    finally { setSaving(false); }
  }
  const field = (key: "firstName"|"lastName"|"phone"|"birthDate"|"cpf", label: string, type="text") => <label className="block text-sm font-semibold text-slate-700">{label}<input type={type} value={profile[key]} onChange={(event)=>setProfile((value)=>({...value,[key]:event.target.value}))} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:border-[#0c2d72] focus:ring-2 focus:ring-[#0c2d72]/20" /></label>;
  return <form onSubmit={submit} className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2">{field("firstName","Nome")}{field("lastName","Sobrenome")}{field("phone","Telefone","tel")}{field("birthDate","Data de nascimento","date")}{field("cpf","CPF")}
      <label className="block text-sm font-semibold text-slate-700">E-mail<input value={profile.email} readOnly aria-readonly="true" className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 font-normal text-slate-500" /><span className="mt-1 block text-xs font-normal text-slate-500">A alteração de e-mail exige verificação segura.</span></label>
    </div>
    <fieldset className="rounded-xl border border-slate-200 p-4"><legend className="px-2 font-bold text-[#071f5c]">Alterar senha</legend><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Senha atual<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3" /></label><label className="text-sm font-semibold">Nova senha<input type="password" minLength={8} autoComplete="new-password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3" /></label></div></fieldset>
    {message ? <p role="status" className="text-sm text-slate-700">{message}</p> : null}<Button type="submit" disabled={saving}>{saving?"Salvando...":"Salvar alterações"}</Button>
  </form>;
}
