"use client";

import clsx from "clsx";
import { useId } from "react";

interface ProductQuantityProps {
  value: number;
  max?: number;
  onChange: (quantity: number) => void;
  fullWidthOnMobile?: boolean;
  showLabel?: boolean;
}

export function ProductQuantity({
  value,
  max,
  onChange,
  fullWidthOnMobile = true,
  showLabel = true,
}: ProductQuantityProps) {
  const labelId = useId();
  const effectiveMax = Math.min(999, max ?? 999);
  const canIncrease = value < effectiveMax;

  return (
    <div className={clsx(fullWidthOnMobile ? "w-full" : "w-auto", "sm:w-auto")}>
      <span
        id={labelId}
        className={
          showLabel
            ? "mb-2 block text-sm font-semibold text-slate-800"
            : "sr-only"
        }
      >
        Quantidade
      </span>
      <div
        className={clsx(
          "items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 sm:inline-flex sm:w-auto sm:justify-start",
          fullWidthOnMobile
            ? "flex w-full justify-between"
            : "inline-flex w-auto justify-start",
        )}
        role="group"
        aria-labelledby={labelId}
      >
        <button
          type="button"
          onClick={() => onChange(Math.max(1, value - 1))}
          disabled={value <= 1}
          aria-label="Diminuir quantidade"
          className="flex h-10 w-10 items-center justify-center rounded-md text-xl font-semibold text-[#0c2d72] transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0c2d72] disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <input
          type="number"
          min={1}
          max={effectiveMax}
          step={1}
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const nextValue = event.currentTarget.valueAsNumber;
            if (!Number.isFinite(nextValue)) return;
            const integerValue = Math.max(1, Math.trunc(nextValue));
            onChange(Math.min(effectiveMax, integerValue));
          }}
          aria-label="Quantidade"
          className="h-10 w-14 appearance-none border-x border-slate-200 bg-white text-center text-base font-semibold text-slate-900 outline-none focus:border-[#0c2d72] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={() => canIncrease && onChange(value + 1)}
          disabled={!canIncrease}
          aria-label="Aumentar quantidade"
          className="flex h-10 w-10 items-center justify-center rounded-md text-xl font-semibold text-[#0c2d72] transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0c2d72] disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}
