"use client";

interface ProductQuantityProps {
  value: number;
  max?: number;
  onChange: (quantity: number) => void;
}

export function ProductQuantity({
  value,
  max,
  onChange,
}: ProductQuantityProps) {
  const canIncrease = max === undefined || value < max;

  return (
    <div>
      <span id="product-quantity-label" className="mb-2 block text-sm font-semibold text-slate-800">
        Quantidade
      </span>
      <div
        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1"
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
