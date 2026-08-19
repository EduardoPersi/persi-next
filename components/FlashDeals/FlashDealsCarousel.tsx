import type { ReactNode } from "react";

export function FlashDealsCarousel({ children }: { children: ReactNode }) {
  return (
    <div
      className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4 xl:grid-cols-6"
      role="list"
      aria-label="Produtos em oferta relâmpago"
    >
      {children}
    </div>
  );
}
