"use client";

import { ShoppingCart, X } from "lucide-react";
import { useEffect } from "react";
import { Drawer } from "./Drawer";

type MiniCartProps = {
  open: boolean;
  onClose: () => void;
};

export function MiniCart({ open, onClose }: MiniCartProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    if (open) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          open ? "opacity-100 visible" : "opacity-0 invisible"
        }`}
      />

      <aside
        className={`fixed right-0 top-0 z-50 flex h-screen w-full max-w-[360px]
        flex-col bg-white shadow-2xl transition-transform duration-300
        ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <header className="flex items-center justify-between border-b px-6 py-5">
          <h2 className="text-xl font-bold">Carrinho (0)</h2>

          <button
            onClick={onClose}
            className="rounded-md p-2 transition hover:bg-slate-100"
            aria-label="Fechar carrinho"
          >
            <X size={22} />
          </button>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <ShoppingCart
            size={72}
            strokeWidth={1.4}
            className="text-slate-300"
          />

          <h3 className="mt-6 text-lg font-semibold">
            Seu carrinho está vazio
          </h3>

          <p className="mt-3 text-sm leading-6 text-slate-500">
            Adicione produtos ao carrinho para visualizar o subtotal e finalizar
            sua compra.
          </p>

          <button
            onClick={onClose}
            className="mt-8 w-full rounded-md bg-[#0c2d72] py-3 font-semibold text-white transition hover:bg-[#17439f]"
          >
            CONTINUAR COMPRANDO
          </button>
        </main>

        <footer className="border-t p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-slate-600">Subtotal</span>

            <strong className="text-lg">R$ 0,00</strong>
          </div>

          <button
            disabled
            className="w-full cursor-not-allowed rounded-md bg-slate-200 py-3 font-semibold text-slate-500"
          >
            FINALIZAR COMPRA
          </button>
        </footer>
      </aside>
    </>
  );
}
