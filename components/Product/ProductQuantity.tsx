"use client";

import clsx from "clsx";

interface ProductQuantityProps {
  value: number;
  max?: number;
  onChange: (quantity: number) => void;
  fullWidthOnMobile?: boolean;
}

export function ProductQuantity({
  value,
  max,
  onChange,
  fullWidthOnMobile = true,
}: ProductQuantityProps) {
  const canIncrease = max === undefined || value < max;

  return (
    <div className={clsx(fullWidthOnMobile ? "w-full" : "w-auto", "sm:w-auto")}>
      <span id="product-quantity-label" className="mb-2 block text-sm font-semibold text-slate-800">
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
        aria-labelledby="product-quantity-label"
      >
        <button
          type="button"
          onClick={() => onChange(Math.max(1, value - 1))}
          disabled={value <= 1}
          aria-label="Diminuir quantidade"
          className="flex h-10 w-10 items-center justify-center rounded-md text-xl font-semibold text-[#0c2d72] transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <output
          className="min-w-10 text-center text-base font-semibold text-slate-900"
          aria-live="polite"
        >
          {value}
        </output>
        <button
          type="button"
          onClick={() => canIncrease && onChange(value + 1)}
          disabled={!canIncrease}
          aria-label="Aumentar quantidade"
          className="flex h-10 w-10 items-center justify-center rounded-md text-xl font-semibold text-[#0c2d72] transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}
