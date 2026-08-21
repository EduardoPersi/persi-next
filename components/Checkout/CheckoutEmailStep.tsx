"use client";

import { Mail } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "@/components/UI/Button";

interface CheckoutEmailStepProps {
  email: string;
  error: string;
  loading: boolean;
  onChange: (email: string) => void;
  onSubmit: () => void;
}

export function CheckoutEmailStep({
  email,
  error,
  loading,
  onChange,
  onSubmit,
}: CheckoutEmailStepProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <div className="w-full max-w-xl text-center">
      <Mail className="mx-auto h-11 w-11 text-slate-400" aria-hidden="true" />
      <h1 className="mt-5 text-xl font-bold text-slate-900">Informe seu e-mail</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
        Preencha seu e-mail para iniciar. Utilizaremos este endereço para
        acessar sua conta ou criar uma nova.
      </p>

      <form onSubmit={submit} noValidate className="mt-6">
        <label htmlFor="checkout-identity-email" className="sr-only">
          Seu e-mail
        </label>
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:flex-row">
          <input
            id="checkout-identity-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(event) => onChange(event.target.value)}
            placeholder="seu@email.com"
            aria-invalid={Boolean(error)}
            aria-describedby="checkout-identity-status"
            className="min-h-11 min-w-0 flex-1 rounded-xl px-4 text-slate-900 outline-none focus:ring-2 focus:ring-[#0c2d72]/25"
          />
          <Button type="submit" disabled={loading} className="sm:min-w-28">
            {loading ? "Verificando..." : "Avançar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
