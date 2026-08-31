"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/UI/Button";
import { PasswordInput } from "@/components/UI/PasswordInput";
import { RecaptchaNotice } from "@/components/UI/RecaptchaNotice";
import { useRecaptcha } from "@/hooks/useRecaptcha";

const inputClassName =
  "min-h-11 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

export function AccountResetPasswordForm({
  login,
  keyValue,
}: {
  login: string;
  keyValue: string;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const { getRecaptchaToken } = useRecaptcha();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const data = new FormData(event.currentTarget);
    setLoading(true);
    setMessage("");
    try {
      const recaptchaToken = (await getRecaptchaToken("account_reset_password")) ?? "";
      const response = await fetch("/api/account/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login,
          key: keyValue,
          password: String(data.get("password") ?? ""),
          passwordConfirmation: String(data.get("passwordConfirmation") ?? ""),
          recaptchaToken,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setMessage("Senha redefinida com sucesso. Você já pode entrar.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível redefinir a senha agora.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <label htmlFor="reset-password" className="mb-2 block font-medium">
          Nova senha
        </label>
        <PasswordInput
          id="reset-password"
          name="password"
          minLength={8}
          required
          autoComplete="new-password"
          className={inputClassName}
          disabled={loading}
        />
      </div>
      <div>
        <label htmlFor="reset-confirm" className="mb-2 block font-medium">
          Confirmar nova senha
        </label>
        <PasswordInput
          id="reset-confirm"
          name="passwordConfirmation"
          minLength={8}
          required
          autoComplete="new-password"
          className={inputClassName}
          disabled={loading}
        />
      </div>
      {message ? <p role="status">{message}</p> : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Redefinindo..." : "Redefinir senha"}
      </Button>
      <RecaptchaNotice className="text-center" />
    </form>
  );
}
