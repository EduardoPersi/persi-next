"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useCart } from "@/hooks/useCart";
import { useRouteTransition } from "@/hooks/useRouteTransition";
import type { CartItem } from "@/types/cart";
import { QuantityControl } from "./QuantityControl";
import {
  canIncreaseQuantity,
  getQuantityLimits,
  resolveTypedQuantity,
  stepQuantity,
} from "./quantityStepping";

interface QuantityStepperProps {
  item: CartItem;
  size?: "sm" | "md";
  // Remover o último item leva para esta rota (ex.: do checkout para o carrinho).
  itemCount?: number;
  emptyCartHref?: string;
}

// Quantidade de um item que já está no carrinho (carrinho, mini-carrinho e
// resumo do checkout). Usa as mesmas ações do carrinho (`updateItem` e
// `removeItem` em CartProvider): o total, o frete e o estoque são recalculados
// e confirmados pelo servidor, nada é calculado aqui. No mínimo, o "−" (ou
// digitar 0) pergunta "Remover este item?".
export const QuantityStepper = memo(function QuantityStepper({
  item,
  size = "md",
  itemCount,
  emptyCartHref,
}: QuantityStepperProps) {
  const { updateItem, removeItem, pendingItemKey, isCheckoutUpdating, isLoading } =
    useCart();
  const { navigate } = useRouteTransition();
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const limits = getQuantityLimits(item);
  // Qualquer atualização em andamento trava os botões (evita clique duplo).
  const isBusy = isCheckoutUpdating || isLoading || pendingItemKey !== null;
  const isThisItemPending = pendingItemKey === item.key;
  const label = `Quantidade de ${item.name}`;

  useEffect(() => {
    if (isConfirmingRemoval) cancelRef.current?.focus();
  }, [isConfirmingRemoval]);

  const applyQuantity = async (quantity: number, adjustment?: string) => {
    setError("");
    setNotice(adjustment ?? "");
    const result = await updateItem(item.key, quantity);
    if (!result.success) {
      setNotice("");
      setError(result.message);
      return;
    }
    const updatedQuantity = result.cart?.items.find(
      (cartItem) => cartItem.key === item.key,
    )?.quantity;
    if (updatedQuantity !== undefined && updatedQuantity !== quantity) {
      setNotice(`Ajustamos para ${updatedQuantity} conforme o estoque disponível.`);
    }
  };

  const step = (direction: "decrease" | "increase") => {
    if (isBusy) return;
    const next = stepQuantity(item.quantity, direction, limits);
    if (next.action === "none") return;
    if (next.action === "remove") {
      setIsConfirmingRemoval(true);
      return;
    }
    void applyQuantity(next.quantity);
  };

  const commitTyped = (raw: string) => {
    if (isBusy) return;
    const next = resolveTypedQuantity(raw, limits, { zero: "remove" });
    if (next.action === "none") return;
    if (next.action === "remove") {
      setIsConfirmingRemoval(true);
      return;
    }
    if (next.quantity === item.quantity) {
      setError("");
      setNotice(next.notice ?? "");
      return;
    }
    void applyQuantity(next.quantity, next.notice);
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
    if (emptyCartHref && (itemCount ?? 0) <= 1) navigate(emptyCartHref);
  };

  return (
    <div className="min-w-0">
      <QuantityControl
        value={item.quantity}
        label={label}
        size={size}
        pending={isThisItemPending}
        disabled={isBusy}
        // O "−" fica ativo no mínimo: ele pergunta se quer remover.
        canDecrease
        canIncrease={canIncreaseQuantity(item.quantity, limits)}
        onDecrease={() => step("decrease")}
        onIncrease={() => step("increase")}
        onCommit={commitTyped}
        error={error}
        notice={notice}
      />
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
            onClick={() => setIsConfirmingRemoval(false)}
            disabled={isBusy}
            className="min-h-9 rounded-xl border border-secondary bg-white px-3 font-medium text-secondary transition-colors hover:bg-secondary/10 active:bg-secondary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      ) : null}
    </div>
  );
});
