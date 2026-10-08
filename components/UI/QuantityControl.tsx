"use client";

import { useState } from "react";
import clsx from "clsx";
import { LoaderCircle, Minus, Plus } from "lucide-react";

type QuantityControlSize = "sm" | "md" | "lg";

interface QuantityControlProps {
  value: number;
  // Nome acessível do grupo (ex.: "Quantidade de Cano PVC 25mm").
  label: string;
  canDecrease: boolean;
  canIncrease: boolean;
  disabled?: boolean;
  pending?: boolean;
  size?: QuantityControlSize;
  // Ocupa toda a largura do contêiner (o campo estica; os botões não).
  fullWidth?: boolean;
  className?: string;
  onDecrease: () => void;
  onIncrease: () => void;
  // Valor digitado, aplicado ao sair do campo ou com Enter (nunca a cada tecla).
  onCommit: (raw: string) => void;
  error?: string;
  notice?: string;
}

const SIZE_CLASSES: Record<QuantityControlSize, { button: string; input: string }> = {
  sm: { button: "h-9 w-9", input: "h-9 min-w-10 text-sm" },
  md: { button: "h-10 w-10", input: "h-10 min-w-12 text-sm" },
  lg: { button: "h-[50px] w-12", input: "h-[50px] min-w-12 text-base" },
};

// Controle visual único de quantidade: [ − ] [ campo editável ] [ + ]. Só
// desenha e repassa os eventos: quem decide o que fazer (atualizar o carrinho,
// pedir confirmação de remoção ou só guardar o valor antes de comprar) é o
// componente que o usa — QuantityStepper (carrinho) ou ProductQuantity (produto).
// Cores e hover seguem o botão secundário do site (variante "secondary" de Button).
export function QuantityControl({
  value,
  label,
  canDecrease,
  canIncrease,
  disabled = false,
  pending = false,
  size = "md",
  fullWidth = false,
  className,
  onDecrease,
  onIncrease,
  onCommit,
  error,
  notice,
}: QuantityControlProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const sizes = SIZE_CLASSES[size];
  const buttonClass = clsx(
    "inline-flex shrink-0 items-center justify-center text-secondary transition-colors hover:bg-secondary/10 active:bg-secondary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
    sizes.button,
  );

  const commit = () => {
    if (draft === null) return;
    const raw = draft;
    setDraft(null);
    onCommit(raw);
  };

  return (
    <div className={clsx("min-w-0", fullWidth && "w-full")}>
      <div
        role="group"
        aria-label={label}
        aria-busy={pending}
        className={clsx(
          "items-center overflow-hidden rounded-xl border border-secondary bg-white",
          fullWidth ? "flex w-full" : "inline-flex",
          className,
        )}
      >
        <button
          type="button"
          className={buttonClass}
          disabled={disabled || !canDecrease}
          aria-label={`Diminuir ${label.toLocaleLowerCase("pt-BR")}`}
          onClick={onDecrease}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <div className="relative min-w-0 flex-1">
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
              setDraft(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
            }
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setDraft(null);
            }}
            className={clsx(
              "w-full border-x border-secondary/40 bg-white px-1 text-center font-semibold tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring disabled:opacity-60",
              sizes.input,
            )}
          />
          {pending ? (
            <LoaderCircle
              size={14}
              className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 animate-spin text-secondary"
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
          <Plus size={16} aria-hidden="true" />
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
