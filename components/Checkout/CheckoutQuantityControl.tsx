"use client";

import { useState } from "react";
import { LoaderCircle, Minus, Plus } from "lucide-react";
import { useCart } from "@/hooks/useCart";
import type { CartItem } from "@/types/cart";

interface CheckoutQuantityControlProps {
  item: CartItem;
}

export function getCheckoutQuantityBounds(item: CartItem) {
  const minimum = Math.max(1, item.minQuantity);
  const maximum = Math.max(minimum, item.maxQuantity ?? 999);
  const step = Math.max(1, item.quantityStep);
  return { minimum, maximum, step };
}

export function CheckoutQuantityControl({ item }: CheckoutQuantityControlProps) {
  const { updateItem, pendingItemKey, isCheckoutUpdating } = useCart();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { minimum, maximum, step } = getCheckoutQuantityBounds(item);
  const isThisItemPending = isSubmitting || pendingItemKey === item.key;
  const isAnotherCheckoutMutationPending =
    isCheckoutUpdating && pendingItemKey === null;
  const controlsDisabled = isThisItemPending || isAnotherCheckoutMutationPending;

  async function changeQuantity(nextQuantity: number) {
    if (
      controlsDisabled ||
      nextQuantity < minimum ||
      nextQuantity > maximum ||
      nextQuantity === item.quantity
    ) return;

    setIsSubmitting(true);
    setError("");
    try {
      const result = await updateItem(item.key, nextQuantity);
      if (!result.success) setError(result.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-w-0">
      <div
        className="inline-flex items-center rounded-xl border border-slate-300 bg-white"
        aria-label={`Quantidade de ${item.name}`}
        aria-busy={isThisItemPending}
      >
        <button
          type="button"
          onClick={() => void changeQuantity(item.quantity - step)}
          disabled={controlsDisabled || item.quantity <= minimum}
          aria-label={`Diminuir quantidade de ${item.name}`}
          className="flex h-11 w-11 items-center justify-center rounded-l-xl text-slate-700 transition-colors hover:bg-slate-50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-slate-300"
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <span
          className="flex h-11 min-w-9 items-center justify-center border-x border-slate-200 px-1 text-sm font-semibold tabular-nums text-slate-900"
          aria-live="polite"
          aria-atomic="true"
        >
          {isThisItemPending ? (
            <LoaderCircle
              size={16}
              className="animate-spin text-primary"
              aria-label={`Atualizando quantidade de ${item.name}`}
            />
          ) : item.quantity}
        </span>
        <button
          type="button"
          onClick={() => void changeQuantity(item.quantity + step)}
          disabled={controlsDisabled || item.quantity >= maximum}
          aria-label={`Aumentar quantidade de ${item.name}`}
          className="flex h-11 w-11 items-center justify-center rounded-r-xl text-slate-700 transition-colors hover:bg-slate-50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-slate-300"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <p className="mt-1 max-w-56 text-xs leading-4 text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
