"use client";

import { useState } from "react";
import clsx from "clsx";
import { LoaderCircle, Minus, Plus } from "lucide-react";

// "md": padrão compacto de todo o site (carrinho, mini-carrinho, checkout,
// "comprados juntos"): 114 x 36 px (36 + 40 + 36 + bordas), fixo, sem esticar até a borda do cartão.
// "lg": página de produto e visualização rápida, na altura do botão de comprar
// (50 px); nas grades da página de produto ocupa a coluna dela (`fullWidth`).
type QuantityControlSize = "md" | "lg";

interface QuantityControlProps {
  value: number;
  // Nome acessível do grupo (ex.: "Quantidade de Cano PVC 25mm").
  label: string;
  canDecrease: boolean;
  canIncrease: boolean;
  disabled?: boolean;
  pending?: boolean;
  size?: QuantityControlSize;
  // Só no "lg": ocupa a largura da coluna em que está (o campo estica).
  fullWidth?: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  // Valor digitado, aplicado ao sair do campo ou com Enter (nunca a cada tecla).
  onCommit: (raw: string) => void;
  error?: string;
  notice?: string;
}

const GROUP_CLASSES: Record<QuantityControlSize, string> = {
  md: "h-9 w-[114px] rounded-md",
  lg: "h-[50px] rounded-xl",
};

const BUTTON_CLASSES: Record<QuantityControlSize, string> = {
  md: "w-9",
  lg: "w-10",
};

const INPUT_CLASSES: Record<QuantityControlSize, string> = {
  md: "text-sm",
  lg: "min-w-0 text-base",
};

// Controle visual único de quantidade: [ − ] [ campo editável ] [ + ]. Só
// desenha e repassa os eventos: quem decide o que fazer (atualizar o carrinho,
// pedir confirmação de remoção ou só guardar o valor antes de comprar) é o
// componente que o usa — QuantityStepper (carrinho) ou ProductQuantity (produto).
// Cores e hover são os dos botões −/+ originais do mini-carrinho.
export function QuantityControl({
  value,
  label,
  canDecrease,
  canIncrease,
  disabled = false,
  pending = false,
  size = "md",
  fullWidth = false,
  onDecrease,
  onIncrease,
  onCommit,
  error,
  notice,
}: QuantityControlProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const stretches = size === "lg" && fullWidth;
  const buttonClass = clsx(
    "flex h-full shrink-0 items-center justify-center text-foreground transition-colors hover:bg-slate-100 active:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent",
    BUTTON_CLASSES[size],
  );

  const commit = () => {
    if (draft === null) return;
    const raw = draft;
    setDraft(null);
    onCommit(raw);
  };

  return (
    <div className={clsx("min-w-0", stretches && "w-full")}>
      <div
        role="group"
        aria-label={label}
        aria-busy={pending}
        className={clsx(
          "flex items-center overflow-hidden border border-slate-200 bg-white",
          GROUP_CLASSES[size],
          stretches ? "w-full" : size === "lg" && "w-[140px]",
        )}
      >
        <button
          type="button"
          className={buttonClass}
          disabled={disabled || !canDecrease}
          aria-label={`Diminuir ${label.toLocaleLowerCase("pt-BR")}`}
          onClick={onDecrease}
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <div className={clsx("relative h-full", size === "lg" ? "min-w-0 flex-1" : "shrink-0")}>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={draft ?? String(value)}
            disabled={disabled}
            aria-label={label}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) =>
              setDraft(event.currentTarget.value.replace(/\D/g, "").slice(0, 4))
            }
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setDraft(null);
            }}
            className={clsx(
              "h-full appearance-none border-x border-slate-200 bg-white text-center font-semibold tabular-nums text-foreground outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 disabled:opacity-60",
              size === "lg" ? "w-full" : "w-10",
              INPUT_CLASSES[size],
            )}
          />
          {pending ? (
            <LoaderCircle
              size={14}
              className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 animate-spin text-primary"
              aria-hidden="true"
            />
          ) : null}
        </div>
        <button
          type="button"
          className={buttonClass}
          disabled={disabled || !canIncrease}
          aria-label={`Aumentar ${label.toLocaleLowerCase("pt-BR")}`}
          onClick={onIncrease}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <p className="mt-1 max-w-56 text-xs leading-4 text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-1 max-w-56 text-xs leading-4 text-amber-700" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
