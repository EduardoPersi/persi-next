"use client";

import { Heart, Search } from "lucide-react";
import { useRef, useState } from "react";
import { useFavorites } from "@/hooks/useFavorites";
import { QuickViewModal } from "./QuickViewModal";

interface ProductCardActionsProps {
  productId: number;
  productSlug: string;
  productName: string;
}

export function ProductCardActions({
  productId,
  productSlug,
  productName,
}: ProductCardActionsProps) {
  const quickViewTriggerRef = useRef<HTMLButtonElement>(null);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = isFavorite(productId);
  const favoriteLabel = favorited
    ? "Remover dos favoritos"
    : "Adicionar aos favoritos";

  return (
    <>
      <div className="absolute right-2 top-11 z-20 flex flex-col gap-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <div className="group/action relative">
          <button
            type="button"
            onClick={() => toggleFavorite(productId)}
            aria-label={`${favoriteLabel}: ${productName}`}
            aria-pressed={favorited}
            title={favoriteLabel}
            className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-white text-[#0c2d72] shadow-sm transition-colors hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
          >
            <Heart
              className={`h-5 w-5 ${
                favorited ? "fill-[#ff6a00] text-[#ff6a00]" : ""
              }`}
              aria-hidden="true"
            />
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute right-full top-1/2 mr-2 hidden -translate-y-1/2 whitespace-nowrap rounded-[6px] bg-slate-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity md:block md:group-hover/action:opacity-100 md:group-focus-within/action:opacity-100"
          >
            {favoriteLabel}
          </span>
        </div>

        <div className="group/action relative">
          <button
            ref={quickViewTriggerRef}
            type="button"
            onClick={() => setIsQuickViewOpen(true)}
            aria-label={`Visualização rápida: ${productName}`}
            aria-haspopup="dialog"
            aria-expanded={isQuickViewOpen}
            title="Visualização rápida"
            className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-white text-[#0c2d72] shadow-sm transition-colors hover:text-[#ff6a00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute right-full top-1/2 mr-2 hidden -translate-y-1/2 whitespace-nowrap rounded-[6px] bg-slate-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity md:block md:group-hover/action:opacity-100 md:group-focus-within/action:opacity-100"
          >
            Visualização rápida
          </span>
        </div>
      </div>

      {isQuickViewOpen ? (
        <QuickViewModal
          productSlug={productSlug}
          onClose={() => setIsQuickViewOpen(false)}
          returnFocusRef={quickViewTriggerRef}
        />
      ) : null}
    </>
  );
}
