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
    const label =
      available && (productType === "variable" || hasOptions)
        ? "Ver opções"
        : "Ver produto";

    return (
      <div className="mt-3">
        <Link
          href={href}
          className="inline-flex h-10 min-h-10 w-full items-center justify-center rounded-[6px] border border-[#0c2d72] px-3 text-center text-base font-medium text-[#0c2d72] transition-colors hover:bg-[#0c2d72] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2 md:text-sm"
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
        className="-mx-1.5 inline-flex h-10 w-[calc(100%+0.75rem)] items-center justify-center rounded-[6px] bg-[#ff6a00] px-2 py-1 text-center text-[10px] font-medium leading-[13px] text-white transition-colors hover:bg-[#e85f00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6a00] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 lg:mx-0 lg:w-full lg:px-3 lg:py-2 lg:text-sm lg:leading-4"
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
        <p className="mt-1 text-xs text-slate-600" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
