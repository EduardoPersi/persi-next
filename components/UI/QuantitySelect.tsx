"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useCart } from "@/hooks/useCart";
import type { CartItem } from "@/types/cart";
import { getQuantityOptions } from "./quantityOptions";

interface QuantitySelectProps {
  item: CartItem;
  idSuffix: string;
}

export const QuantitySelect = memo(function QuantitySelect({
  item,
  idSuffix,
}: QuantitySelectProps) {
  const { updateItem, pendingItemKey } = useCart();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [adjustmentMessage, setAdjustmentMessage] = useState("");
  const minimum = Math.max(1, item.minQuantity);
  const maximum = Math.max(minimum, item.maxQuantity ?? 999);
  const quantityStep = Math.max(1, item.quantityStep);
  const isThisItemPending = isSubmitting || pendingItemKey === item.key;
  const quantities = useMemo(
    () => getQuantityOptions(item.quantity, minimum, maximum, quantityStep),
    [item.quantity, maximum, minimum, quantityStep],
  );
  const label = `Quantidade de ${item.name}`;

  const changeQuantity = useCallback(async (nextQuantity: number) => {
    if (
      isThisItemPending ||
      nextQuantity < minimum ||
      nextQuantity > maximum ||
      nextQuantity === item.quantity
    ) return;

    setIsSubmitting(true);
    setError("");
    setAdjustmentMessage("");
    try {
      const result = await updateItem(item.key, nextQuantity);
      if (!result.success) {
        setError(result.message);
        return;
      }
      const updatedQuantity = result.cart?.items.find(
        (cartItem) => cartItem.key === item.key,
      )?.quantity;
      if (updatedQuantity !== undefined && updatedQuantity !== nextQuantity) {
        setAdjustmentMessage(
          "A quantidade foi ajustada conforme o estoque disponível.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isThisItemPending,
    item.key,
    item.quantity,
    maximum,
    minimum,
    updateItem,
  ]);

  return (
    <div className="min-w-0">
      <div className="relative inline-flex shrink-0 items-center" aria-busy={isThisItemPending}>
        <select
          id={`quantity-${idSuffix}-${item.key}`}
          value={item.quantity}
          aria-label={label}
          title={label}
          onChange={(event) => void changeQuantity(Number(event.currentTarget.value))}
          className="h-9 min-w-16 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white py-0 pl-2.5 pr-7 text-sm font-medium tabular-nums text-foreground transition-colors hover:border-slate-400 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:min-w-[72px] sm:pl-3 sm:pr-8"
        >
          {quantities.map((quantity) => (
            <option key={quantity} value={quantity}>{quantity}</option>
          ))}
        </select>
        {isThisItemPending ? (
          <LoaderCircle
            size={14}
            className="pointer-events-none absolute right-1.5 animate-spin bg-white text-primary"
            aria-label={`Atualizando ${label.toLocaleLowerCase("pt-BR")}`}
          />
        ) : null}
      </div>
      {error ? (
        <p className="mt-1 max-w-56 text-xs leading-4 text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {adjustmentMessage ? (
        <p
          className="mt-1 max-w-56 text-xs leading-4 text-amber-700"
          role="status"
        >
          {adjustmentMessage}
        </p>
      ) : null}
    </div>
  );
});
