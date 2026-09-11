"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/hooks/useCart";

interface ProductCardActionProps {
  productId: number;
  productType: string;
  href: string;
  available: boolean;
  isPurchasable: boolean;
  hasOptions: boolean;
}

export function ProductCardAction({
  productId,
  productType,
  href,
  available,
  isPurchasable,
  hasOptions,
}: ProductCardActionProps) {
  const { addItem } = useCart();
  const [isAdding, setIsAdding] = useState(false);
  const [message, setMessage] = useState("");
  const canAddDirectly =
    available &&
    isPurchasable &&
    productType === "simple" &&
    !hasOptions;

  async function handleAdd() {
    setIsAdding(true);
    setMessage("");
    const result = await addItem(productId, 1);
    setMessage(result.message);
    setIsAdding(false);
  }

  if (!canAddDirectly) {
    if (!available) {
      return (
        <div className="mt-3">
          <Link
            href={href}
            className="-mx-1.5 inline-flex h-10 w-[calc(100%+0.75rem)] items-center justify-center rounded-xl bg-slate-600 px-3 text-center text-base font-medium uppercase text-white transition-colors hover:bg-slate-700 active:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600 focus-visible:ring-offset-2 lg:mx-0 lg:w-full md:text-sm"
          >
            Avise-me
          </Link>
          <div className="mt-1 min-h-4" aria-hidden="true" />
        </div>
      );
    }

    const label =
      productType === "variable" || hasOptions ? "Ver opções" : "Ver produto";

    return (
      <div className="mt-3">
        <Link
          href={href}
          className="-mx-1.5 inline-flex h-10 w-[calc(100%+0.75rem)] items-center justify-center rounded-xl border border-primary px-3 text-center text-base font-medium text-primary transition-colors hover:bg-primary hover:text-white active:bg-primary-hover active:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 lg:mx-0 lg:w-full md:text-sm"
        >
          {label}
        </Link>
        <div className="mt-1 min-h-4" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleAdd}
        disabled={isAdding}
        className="-mx-1.5 inline-flex h-10 w-[calc(100%+0.75rem)] items-center justify-center rounded-xl bg-secondary px-2 py-1 text-center text-[10px] font-medium leading-[13px] text-white transition-colors hover:bg-secondary-hover active:bg-secondary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 lg:mx-0 lg:w-full lg:px-3 lg:py-2 lg:text-sm lg:leading-4"
      >
        {isAdding ? (
          "Adicionando..."
        ) : (
          <span className="flex flex-col items-center justify-center gap-0">
            <span>Adicionar ao</span>
            <span className="-mt-[6px]">carrinho</span>
          </span>
        )}
      </button>
      {message ? (
        <p className="mt-1 text-xs text-muted" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
