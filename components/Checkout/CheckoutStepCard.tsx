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
// mostra os campos quando ativa, um resumo clicável (o próprio bloco leva de
// volta à etapa) quando já concluída, e um texto explicativo desabilitado
// quando ainda não chegou a vez dela — reproduz o assistente por etapas do
// checkout antigo.
export function CheckoutStepCard({
  step,
  title,
  state,
  upcomingText,
  doneSummary,
  onEdit,
  children,
}: CheckoutStepCardProps) {
  const borderClass =
    state === "done"
      ? "border-emerald-300"
      : state === "upcoming"
        ? "border-black/25"
        : "border-black";
  // No mobile só a etapa ativa fica visível — voltar para uma etapa
  // concluída é feito pelo CheckoutMobileStepper no topo, então o resumo
  // "done" aqui seria redundante; etapas futuras também ficam escondidas
  // (fluxo tipo assistente, uma "página" por vez). No desktop as três
  // colunas continuam visíveis ao mesmo tempo.
  const visibilityClass = state !== "active" && "hidden lg:block";

  if (state === "done" && onEdit) {
    return (
      <section
        className={clsx(
          "overflow-hidden rounded-xl border bg-white shadow-sm",
          borderClass,
          visibilityClass,
        )}
      >
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${title}`}
          className="flex w-full flex-col items-start gap-3 p-4 text-left transition-colors hover:bg-emerald-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset sm:p-6"
        >
          <span className="flex items-center gap-3">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0c2d72] text-sm font-bold text-white"
              aria-hidden="true"
            >
              <Check size={16} />
            </span>
            <h2 className="text-base font-bold text-black">{title}</h2>
          </span>
          <span className="text-xs text-slate-700">{doneSummary}</span>
        </button>
        {/* Mantém os campos montados (só ocultos) para preservar os valores
            já digitados no react-hook-form (shouldUnregister: false) sem
            perder o registro dos inputs. */}
        <div className="hidden">{children}</div>
      </section>
    );
  }

  return (
    <section
      className={clsx(
        "rounded-xl border bg-white p-4 shadow-sm sm:p-6",
        borderClass,
        visibilityClass,
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
          {step}
        </span>
        <h2
          className={clsx(
            "text-base font-bold",
            state === "upcoming" ? "text-slate-400" : "text-black",
          )}
        >
          {title}
        </h2>
      </div>

      <div className={state === "active" ? "mt-5" : "mt-3"}>
        {state === "upcoming" ? (
          <p className="text-xs text-slate-500">{upcomingText}</p>
        ) : null}
        {/* Mantém os campos montados (só ocultos) fora do estado "active"
            para preservar os valores já digitados no react-hook-form
            (shouldUnregister: false) sem perder o registro dos inputs. */}
        <div className={state === "active" ? undefined : "hidden"}>
          {children}
        </div>
      </div>
    </section>
  );
}
