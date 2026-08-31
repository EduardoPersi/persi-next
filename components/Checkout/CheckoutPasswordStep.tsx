"use client";

import { LockKeyhole } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "@/components/UI/Button";
import { PasswordInput } from "@/components/UI/PasswordInput";

interface CheckoutPasswordStepProps {
  email: string;
  error: string;
  loading: boolean;
  password: string;
  onBack: () => void;
  onChange: (password: string) => void;
  onRequestCode: () => void;
  onSubmit: () => void;
}

export function CheckoutPasswordStep(props: CheckoutPasswordStepProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onSubmit();
  }

  return (
    <div className="w-full max-w-xl text-center">
      <LockKeyhole className="mx-auto h-11 w-11 text-slate-400" aria-hidden="true" />
      <h1 className="mt-5 text-xl font-bold text-foreground">Agora, sua senha</h1>
      <p className="mt-2 text-sm text-muted">
        Encontramos uma conta para esse e-mail.
      </p>
      <p className="mt-2 font-semibold text-foreground">{props.email}</p>

      <form onSubmit={submit} noValidate className="mt-6 text-left">
        <label htmlFor="checkout-identity-password" className="block text-sm font-medium text-foreground">
          Senha
        </label>
        <PasswordInput
          id="checkout-identity-password"
          value={props.password}
          onChange={(event) => props.onChange(event.target.value)}
          autoComplete="current-password"
          required
          aria-invalid={Boolean(props.error)}
          aria-describedby="checkout-identity-status"
          className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <Button type="submit" disabled={props.loading} className="mt-3 w-full">
          {props.loading ? "Entrando..." : "Avançar"}
        </Button>
      </form>

      <div className="mt-4 flex flex-col items-center justify-center gap-3 text-sm sm:flex-row">
        <button type="button" onClick={props.onRequestCode} disabled={props.loading} className="font-semibold text-secondary underline underline-offset-2 disabled:opacity-50">
          Receber código de acesso
        </button>
        <span className="hidden text-slate-300 sm:inline" aria-hidden="true">|</span>
        <button type="button" onClick={props.onBack} disabled={props.loading} className="font-medium text-primary underline underline-offset-2 disabled:opacity-50">
          Trocar e-mail
        </button>
      </div>
    </div>
  );
}
