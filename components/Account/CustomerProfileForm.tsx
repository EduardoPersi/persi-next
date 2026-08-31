"use client";

import { useState, type FormEvent, type HTMLInputTypeAttribute } from "react";
import { Button } from "@/components/UI/Button";
import { PasswordInput } from "@/components/UI/PasswordInput";
import {
  formatBrazilianCpf,
  formatBrazilianPhone,
} from "@/lib/formatting/personalData";
import type { CustomerWorkspaceProfile } from "@/lib/customer-workspace/types";

type EditableProfileKey = "firstName" | "lastName" | "phone" | "birthDate" | "cpf";

const inputClassName =
  "mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

function formatProfile(profile: CustomerWorkspaceProfile): CustomerWorkspaceProfile {
  return {
    ...profile,
    phone: formatBrazilianPhone(profile.phone),
    cpf: formatBrazilianCpf(profile.cpf),
  };
}

export function CustomerProfileForm({
  initialProfile,
}: {
  initialProfile: CustomerWorkspaceProfile;
}) {
  const [profile, setProfile] = useState(() => formatProfile(initialProfile));
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function updateProfile(key: EditableProfileKey, value: string) {
    const formattedValue =
      key === "phone"
        ? formatBrazilianPhone(value)
        : key === "cpf"
          ? formatBrazilianCpf(value)
          : value;
    setProfile((current) => ({ ...current, [key]: formattedValue }));
  }

  function field(
    key: EditableProfileKey,
    label: string,
    type: HTMLInputTypeAttribute = "text",
  ) {
    const isMaskedField = key === "phone" || key === "cpf";
    return (
      <label className="block text-sm font-semibold text-foreground">
        {label}
        <input
          type={type}
          inputMode={isMaskedField ? "numeric" : undefined}
          autoComplete={key === "phone" ? "tel" : undefined}
          maxLength={key === "phone" ? 15 : key === "cpf" ? 14 : undefined}
          placeholder={key === "phone" ? "(11) 99999-9999" : key === "cpf" ? "000.000.000-00" : undefined}
          value={profile[key]}
          onChange={(event) => updateProfile(key, event.target.value)}
          className={inputClassName}
        />
      </label>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/workspace/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profile,
          displayName: undefined,
          email: undefined,
          currentPassword,
          newPassword,
        }),
      });
      const body = (await response.json()) as CustomerWorkspaceProfile & {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(body.message || "Não foi possível salvar seus dados.");
      }
      setProfile(formatProfile(body));
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Dados atualizados com sucesso.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar seus dados.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {field("firstName", "Nome")}
        {field("lastName", "Sobrenome")}
        {field("phone", "Telefone", "tel")}
        {field("birthDate", "Data de nascimento", "date")}
        {field("cpf", "CPF")}
        <label className="block text-sm font-semibold text-foreground">
          E-mail
          <input
            value={profile.email}
            readOnly
            aria-readonly="true"
            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 font-normal text-muted"
          />
          <span className="mt-1 block text-xs font-normal text-muted">
            A alteração de e-mail exige verificação segura.
          </span>
        </label>
      </div>
      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="px-2 font-bold text-primary-hover">Alterar senha</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label htmlFor="profile-current-password" className="text-sm font-semibold">
            Senha atual
            <PasswordInput
              id="profile-current-password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={inputClassName}
            />
          </label>
          <label htmlFor="profile-new-password" className="text-sm font-semibold">
            Nova senha
            <PasswordInput
              id="profile-new-password"
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={inputClassName}
            />
          </label>
        </div>
      </fieldset>
      {message ? (
        <p role="status" className="text-sm text-foreground">
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={saving}>
        {saving ? "Salvando..." : "Salvar alterações"}
      </Button>
    </form>
  );
}
