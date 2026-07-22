"use client";

import Image from "next/image";
import { Minus, Plus, ShoppingCart, X } from "lucide-react";
import { useEffect } from "react";
import { useCart } from "@/hooks/useCart";

export function MiniCart() {
  const {
    cart,
    isLoading,
    isOpen: open,
    closeCart,
    error,
    updateItem,
  } = useCart();
  const formatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: cart?.currencyCode ?? "BRL",
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeCart();
    }

    if (open) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeCart, open]);

  return (
    <>
      <button
        type="button"
        onClick={closeCart}
        aria-label="Fechar carrinho"
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      />

      <aside
        aria-label="Mini carrinho"
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-50 flex h-screen w-full max-w-[360px] flex-col bg-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b px-6 py-5">
          <h2 className="text-xl font-bold">
            Carrinho ({cart?.itemsCount ?? 0})
          </h2>
          <button
            type="button"
            onClick={closeCart}
            className="rounded-md p-2 transition hover:bg-slate-100"
            aria-label="Fechar carrinho"
          >
            <X size={22} />
          </button>
        </header>

        {cart?.items.length ? (
          <main className="flex-1 space-y-4 overflow-y-auto p-6">
            {cart.items.map((item) => (
              <article key={item.key} className="flex gap-3">
                {item.image ? (
                  <Image
                    src={item.image.src}
                    alt={item.image.alt}
                    width={72}
                    height={72}
                    className="h-[72px] w-[72px] shrink-0 rounded-md border border-slate-200 object-contain"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-2 text-sm font-semibold">
                    {item.name}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatter.format(item.price)} por unidade
                  </p>
                  <div className="mt-2 inline-flex h-8 items-center rounded-md border border-slate-200">
                    <button
                      type="button"
                      onClick={() => void updateItem(item.key, item.quantity - 1)}
                      disabled={isLoading || item.quantity <= 1}
                      aria-label={`Diminuir quantidade de ${item.name}`}
                      className="flex h-full w-8 items-center justify-center rounded-l-md text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      <Minus className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <input
                      key={`${item.key}-${item.quantity}`}
                      type="number"
                      min={1}
                      max={item.maxQuantity ?? 999}
                      step={1}
                      defaultValue={item.quantity}
                      onFocus={(event) => event.currentTarget.select()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      onBlur={(event) => {
                        const nextQuantity = Math.min(
                          item.maxQuantity ?? 999,
                          Math.max(
                            1,
                            Math.trunc(event.currentTarget.valueAsNumber || 1),
                          ),
                        );
                        event.currentTarget.value = String(nextQuantity);
                        if (nextQuantity !== item.quantity) {
                          void updateItem(item.key, nextQuantity);
                        }
                      }}
                      aria-label={`Quantidade de ${item.name}`}
                      className="h-full w-12 appearance-none border-x border-slate-200 bg-white text-center text-sm font-semibold text-slate-900 outline-none focus:border-[#0c2d72] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => void updateItem(item.key, item.quantity + 1)}
                      disabled={
                        isLoading || item.quantity >= (item.maxQuantity ?? 999)
                      }
                      aria-label={`Aumentar quantidade de ${item.name}`}
                      className="flex h-full w-8 items-center justify-center rounded-r-md text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </main>
        ) : (
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
              Adicione produtos ao carrinho para visualizar o subtotal e
              finalizar sua compra.
            </p>
            <button
              type="button"
              onClick={closeCart}
              className="mt-8 w-full rounded-md bg-[#0c2d72] py-3 font-semibold text-white transition hover:bg-[#17439f]"
            >
              CONTINUAR COMPRANDO
            </button>
          </main>
        )}

        {error ? (
          <p className="px-6 pb-3 text-sm text-red-700" role="status">
            {error}
          </p>
        ) : null}

        <footer className="border-t p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-slate-600">Subtotal</span>
            <strong className="text-lg">
              {formatter.format(cart?.subtotal ?? 0)}
            </strong>
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
