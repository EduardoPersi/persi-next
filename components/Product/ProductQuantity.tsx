"use client";

import clsx from "clsx";
import { useId, useState } from "react";
import { QuantityControl } from "@/components/UI/QuantityControl";
import { resolveTypedQuantity } from "@/components/UI/quantityStepping";

interface ProductQuantityProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (quantity: number) => void;
  compact?: boolean;
  dense?: boolean;
  fullWidthOnMobile?: boolean;
  showLabel?: boolean;
  // Nome acessível do grupo; o padrão é "Quantidade".
  label?: string;
}

// Quantidade ANTES de adicionar ao carrinho (página de produto, visualização
// rápida e "comprados juntos"): estado local de quem usa, mesmo visual do
// QuantityControl. O "−" para no mínimo e não pergunta sobre remover.
export function ProductQuantity({
  value,
  min = 1,
  max,
  step = 1,
  onChange,
  compact = false,
  dense = false,
  fullWidthOnMobile = true,
  showLabel = true,
  label = "Quantidade",
}: ProductQuantityProps) {
  const labelId = useId();
  const [notice, setNotice] = useState("");
  const limits = {
    minimum: Math.max(1, min),
    maximum: Math.max(Math.max(1, min), Math.min(999, max ?? 999)),
    step: Math.max(1, step),
  };

  const change = (next: number) => {
    setNotice("");
    onChange(next);
  };

  const commitTyped = (raw: string) => {
    const next = resolveTypedQuantity(raw, limits, { zero: "minimum" });
    if (next.action !== "update") return;
    setNotice(next.notice ?? "");
    if (next.quantity !== value) onChange(next.quantity);
  };

  return (
    <div
      className={clsx(
        compact
          ? "w-full min-w-0"
          : [fullWidthOnMobile ? "w-full" : "w-auto", "sm:w-auto"],
      )}
    >
      <span
        id={labelId}
        className={
          showLabel
            ? "mb-2 block text-sm font-semibold text-foreground"
            : "sr-only"
        }
      >
        {label}
      </span>
      <QuantityControl
        value={value}
        label={label}
        size={dense ? "sm" : compact ? "lg" : "md"}
        fullWidth={compact}
        className={
          !compact && fullWidthOnMobile ? "flex w-full sm:inline-flex sm:w-auto" : undefined
        }
        canDecrease={value > limits.minimum}
        canIncrease={value < limits.maximum}
        onDecrease={() => change(Math.max(limits.minimum, value - limits.step))}
        onIncrease={() => change(Math.min(limits.maximum, value + limits.step))}
        onCommit={commitTyped}
        notice={notice}
      />
    </div>
  );
}
