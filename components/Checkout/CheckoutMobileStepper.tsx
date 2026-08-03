"use client";

import clsx from "clsx";
import { Check } from "lucide-react";
import type { CheckoutStep } from "./CheckoutForm";

interface StepDefinition {
  key: CheckoutStep;
  label: string;
}

const STEPS: StepDefinition[] = [
  { key: "profile", label: "Dados pessoais" },
  { key: "address", label: "Entrega" },
  { key: "payment", label: "Pagamento" },
];

interface CheckoutMobileStepperProps {
  currentStep: CheckoutStep;
  completedSteps: readonly CheckoutStep[];
  onStepSelect: (step: CheckoutStep) => void;
}

// Indicador de progresso só para mobile — no desktop os três cartões da
// etapa (com seus próprios números) já ficam visíveis ao mesmo tempo, então
// esse indicador extra seria redundante lá.
export function CheckoutMobileStepper({
  currentStep,
  completedSteps,
  onStepSelect,
}: CheckoutMobileStepperProps) {
  const currentIndex = STEPS.findIndex((step) => step.key === currentStep);

  return (
    <ol className="flex border-b border-slate-200 bg-white px-2 py-3 lg:hidden">
      {STEPS.map((step, index) => {
        const isDone = completedSteps.includes(step.key);
        const isActive = step.key === currentStep;
        const isClickable = isDone && !isActive;

        return (
          <li key={step.key} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="relative flex h-7 w-full items-center justify-center">
              {index > 0 ? (
                <span
                  className={clsx(
                    "absolute left-0 right-1/2 top-1/2 h-0.5 -translate-y-1/2",
                    index <= currentIndex ? "bg-primary" : "bg-slate-200",
                  )}
                  aria-hidden="true"
                />
              ) : null}
              {index < STEPS.length - 1 ? (
                <span
                  className={clsx(
                    "absolute left-1/2 right-0 top-1/2 h-0.5 -translate-y-1/2",
                    index < currentIndex ? "bg-primary" : "bg-slate-200",
                  )}
                  aria-hidden="true"
                />
              ) : null}
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => onStepSelect(step.key)}
                aria-current={isActive ? "step" : undefined}
                aria-label={`${step.label}${isDone ? " (concluído)" : ""}`}
                className={clsx(
                  "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white transition",
                  isActive || isDone ? "bg-primary" : "bg-slate-300",
                  isClickable ? "cursor-pointer" : "cursor-default",
                )}
              >
                {isDone && !isActive ? <Check size={14} aria-hidden="true" /> : index + 1}
              </button>
            </div>
            <span
              className={clsx(
                "text-center text-[11px] font-medium leading-tight",
                isActive ? "text-primary" : "text-slate-500",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
