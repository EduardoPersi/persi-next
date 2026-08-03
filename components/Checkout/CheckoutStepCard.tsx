"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { Check } from "lucide-react";

export type CheckoutStepState = "active" | "upcoming" | "done";

interface CheckoutStepCardProps {
  step: number;
  title: string;
  state: CheckoutStepState;
  upcomingText?: string;
  doneSummary?: ReactNode;
  onEdit?: () => void;
  children: ReactNode;
}

// Cartão de uma etapa do checkout (Perfil / Endereço de entrega / Pagamento):
// mostra os campos quando ativa, um resumo com opção de editar quando já
// concluída, e um texto explicativo desabilitado quando ainda não chegou a
// vez dela — reproduz o assistente por etapas do checkout antigo.
export function CheckoutStepCard({
  step,
  title,
  state,
  upcomingText,
  doneSummary,
  onEdit,
  children,
}: CheckoutStepCardProps) {
  return (
    <section
      className={clsx(
        "rounded-xl border bg-white p-4 shadow-sm sm:p-6",
        state === "done" ? "border-emerald-300" : "border-slate-200",
      )}
      aria-current={state === "active" ? "step" : undefined}
    >
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",
            state === "upcoming" ? "bg-slate-300" : "bg-[#0c2d72]",
          )}
          aria-hidden="true"
        >
          {state === "done" ? <Check size={16} /> : step}
        </span>
        <h2
          className={clsx(
            "text-lg font-bold",
            state === "upcoming" ? "text-slate-400" : "text-[#0c2d72]",
          )}
        >
          {title}
        </h2>
        {state === "done" && onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="ml-auto text-sm font-medium text-primary underline underline-offset-2"
          >
            Editar
          </button>
        ) : null}
      </div>

      <div className={state === "active" ? "mt-5" : "mt-3"}>
        {state === "upcoming" ? (
          <p className="text-sm text-slate-500">{upcomingText}</p>
        ) : state === "done" ? (
          doneSummary
        ) : null}
        {/* Mantém os campos montados (só ocultos) fora do estado "active" para
            preservar os valores já digitados no react-hook-form
            (shouldUnregister: false) sem perder o registro dos inputs. */}
        <div className={state === "active" ? undefined : "hidden"}>
          {children}
        </div>
      </div>
    </section>
  );
}
