"use client";

import { memo, useEffect, useRef, useState } from "react";
import { LoaderCircle, Minus, Plus } from "lucide-react";
import { useCart } from "@/hooks/useCart";
import { useRouteTransition } from "@/hooks/useRouteTransition";
import type { CartItem } from "@/types/cart";
import {
  canIncreaseQuantity,
  getQuantityLimits,
  stepQuantity,
} from "./quantityStepping";

interface QuantityStepperProps {
  item: CartItem;
  // Quantos itens há no carrinho: remover o último leva de volta ao carrinho.
  itemCount: number;
}

const BUTTON_CLASS =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center text-foreground transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent";

// Controle "− quantidade +" do resumo do checkout. Usa as mesmas ações do
// carrinho (`updateItem` e `removeItem` em CartProvider): o total, o frete e
// o estoque são recalculados e confirmados pelo servidor, nada é calculado aqui.
export const QuantityStepper = memo(function QuantityStepper({
  item,
  itemCount,
}: QuantityStepperProps) {
  const { updateItem, removeItem, pendingItemKey, isCheckoutUpdating, isLoading } =
    useCart();
  const { navigate } = useRouteTransition();
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);
  const [error, setError] = useState("");
  const [adjustmentMessage, setAdjustmentMessage] = useState("");
  const decreaseRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const limits = getQuantityLimits(item);
  // Qualquer atualização em andamento trava os botões (evita clique duplo).
  const isBusy = isCheckoutUpdating || isLoading || pendingItemKey !== null;
  const isThisItemPending = pendingItemKey === item.key;
  const label = `Quantidade de ${item.name}`;

  useEffect(() => {
    if (isConfirmingRemoval) cancelRef.current?.focus();
  }, [isConfirmingRemoval]);

  const change = async (direction: "decrease" | "increase") => {
    if (isBusy) return;
    const next = stepQuantity(item.quantity, direction, limits);
    if (next.action === "none") return;
    if (next.action === "remove") {
      setIsConfirmingRemoval(true);
      return;
    }

    setError("");
    setAdjustmentMessage("");
    const result = await updateItem(item.key, next.quantity);
    if (!result.success) {
      setError(result.message);
      return;
    }
    const updatedQuantity = result.cart?.items.find(
      (cartItem) => cartItem.key === item.key,
    )?.quantity;
    if (updatedQuantity !== undefined && updatedQuantity !== next.quantity) {
      setAdjustmentMessage(
        "A quantidade foi ajustada conforme o estoque disponível.",
      );
    }
  };

  const confirmRemoval = async () => {
    if (isBusy) return;
    setError("");
    const result = await removeItem(item.key);
    if (!result.success) {
      setIsConfirmingRemoval(false);
      setError(result.message);
      return;
    }
    if (itemCount <= 1) navigate("/carrinho");
  };

  const cancelRemoval = () => {
    setIsConfirmingRemoval(false);
    decreaseRef.current?.focus();
  };

  return (
    <div className="min-w-0">
      <div
        role="group"
        aria-label={label}
        aria-busy={isThisItemPending}
        className="inline-flex items-center overflow-hidden rounded-xl border border-slate-300 bg-white"
      >
        <button
          ref={decreaseRef}
          type="button"
          className={BUTTON_CLASS}
          disabled={isBusy}
          aria-label={`Diminuir ${label.toLocaleLowerCase("pt-BR")}`}
          onClick={() => void change("decrease")}
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <span
          className="flex h-10 min-w-9 items-center justify-center px-1 text-sm font-medium tabular-nums text-foreground"
          role="status"
          aria-label={`${label}: ${item.quantity}`}
        >
          {isThisItemPending ? (
            <LoaderCircle size={14} className="animate-spin text-primary" aria-hidden="true" />
          ) : (
            item.quantity
          )}
        </span>
        <button
          type="button"
          className={BUTTON_CLASS}
          disabled={isBusy || !canIncreaseQuantity(item.quantity, limits)}
          aria-label={`Aumentar ${label.toLocaleLowerCase("pt-BR")}`}
          onClick={() => void change("increase")}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      {isConfirmingRemoval ? (
        <div
          role="group"
          aria-label="Confirmar remoção do item"
          className="mt-2 flex flex-wrap items-center gap-2 text-xs"
        >
          <span className="font-medium text-foreground">Remover este item?</span>
          <button
            type="button"
            onClick={() => void confirmRemoval()}
            disabled={isBusy}
            className="min-h-9 rounded-xl bg-red-700 px-3 font-medium text-white transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700/40 disabled:opacity-60"
          >
            Remover
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={cancelRemoval}
            disabled={isBusy}
            className="min-h-9 rounded-xl border border-slate-300 bg-white px-3 font-medium text-foreground transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="mt-1 max-w-56 text-xs leading-4 text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {adjustmentMessage ? (
        <p className="mt-1 max-w-56 text-xs leading-4 text-amber-700" role="status">
          {adjustmentMessage}
        </p>
      ) : null}
    </div>
  );
});
