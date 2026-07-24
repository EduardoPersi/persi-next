"use client";

import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useCart } from "@/hooks/useCart";

export function MiniCart() {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const {
    cart,
    isLoading,
    isOpen: open,
    closeCart,
    error,
    pendingItemKey,
    removeItem,
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
      triggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    }

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
      if (open && triggerRef.current && document.contains(triggerRef.current)) {
        triggerRef.current.focus();
      }
    };
  }, [closeCart, open]);

  return (
    <>
      <button
        type="button"
        onClick={closeCart}
        aria-label="Fechar carrinho"
        aria-hidden={!open}
        inert={!open}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          open
            ? "visible opacity-100"
            : "pointer-events-none invisible opacity-0"
        }`}
      />

      <aside
        id="mini-cart-drawer"
        aria-label="Mini carrinho"
        aria-hidden={!open}
        inert={!open}
        className={`fixed right-0 top-0 z-50 flex h-screen w-full max-w-[360px] flex-col bg-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-semibold">
            Carrinho ({cart?.itemsCount ?? 0})
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeCart}
            className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm font-medium transition hover:bg-slate-100"
            aria-label="Fechar carrinho"
          >
            <X size={18} aria-hidden="true" />
            Fechar
          </button>
        </header>

        {cart?.items.length ? (
          <main className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {cart.items.map((item) => (
              <article key={item.key} className="relative flex gap-3 pr-5">
                {item.image ? (
                  <Image
                    src={item.image.src}
                    alt={item.image.alt}
                    width={60}
                    height={60}
                    className="h-[60px] w-[60px] shrink-0 object-contain"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-2 text-sm font-medium leading-5 text-slate-900">
                    {item.name}
                  </h3>
                  {item.variation.length > 0 ? (
                    <dl className="mt-1 text-xs text-slate-500">
                      {item.variation.map((attribute) => (
                        <div key={`${attribute.attribute}-${attribute.value}`}>
                          <dt className="inline font-medium">
                            {attribute.label}:
                          </dt>{" "}
                          <dd className="inline">{attribute.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="inline-flex h-7 items-center rounded-md border border-slate-200">
                    <button
                      type="button"
                      onClick={() =>
                        void updateItem(
                          item.key,
                          Math.max(
                            item.minQuantity,
                            item.quantity - item.quantityStep,
                          ),
                        )
                      }
                      disabled={
                        isLoading || item.quantity <= item.minQuantity
                      }
                      aria-label={`Diminuir quantidade de ${item.name}`}
                      className="flex h-full w-7 items-center justify-center rounded-l-md text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      <Minus className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <input
                      key={`${item.key}-${item.quantity}`}
                      type="number"
                      min={item.minQuantity}
                      max={item.maxQuantity ?? 999}
                      step={item.quantityStep}
                      defaultValue={item.quantity}
                      onFocus={(event) => event.currentTarget.select()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      onBlur={(event) => {
                        const nextQuantity = Math.min(
                          item.maxQuantity ?? 999,
                          Math.max(
                            item.minQuantity,
                            Math.trunc(event.currentTarget.valueAsNumber || 1),
                          ),
                        );
                        event.currentTarget.value = String(nextQuantity);
                        if (nextQuantity !== item.quantity) {
                          void updateItem(item.key, nextQuantity);
                        }
                      }}
                      aria-label={`Quantidade de ${item.name}`}
                      className="h-full w-9 appearance-none border-x border-slate-200 bg-white text-center text-xs font-semibold text-slate-900 outline-none focus:border-[#0c2d72] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        void updateItem(
                          item.key,
                          Math.min(
                            item.maxQuantity ?? 999,
                            item.quantity + item.quantityStep,
                          ),
                        )
                      }
                      disabled={
                        isLoading || item.quantity >= (item.maxQuantity ?? 999)
                      }
                      aria-label={`Aumentar quantidade de ${item.name}`}
                      className="flex h-full w-7 items-center justify-center rounded-r-md text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      <Plus className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                    <p className="text-xs text-slate-400">
                      {item.quantity} ×{" "}
                      <strong className="font-semibold text-[#0c2d72]">
                        {formatter.format(item.price)}
                      </strong>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void removeItem(item.key)}
                  disabled={pendingItemKey === item.key}
                  aria-label={`Remover ${item.name} do carrinho`}
                  title="Remover produto"
                  className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-wait disabled:opacity-50"
                >
                  {pendingItemKey === item.key ? (
                    <span className="h-3 w-3 animate-spin rounded-full border border-slate-300 border-t-[#0c2d72]" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
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
              className="mt-8 w-full rounded-md bg-[#0c2d72] py-3 font-medium text-white transition hover:bg-[#17439f]"
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

        <footer className="border-t p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-slate-600">Subtotal</span>
            <strong className="text-lg">
              {formatter.format(cart?.subtotal ?? 0)}
            </strong>
          </div>
          <Link
            href="/carrinho"
            onClick={closeCart}
            className="mb-3 inline-flex h-11 w-full items-center justify-center rounded-md border border-[#0c2d72] px-4 font-medium text-[#0c2d72] transition hover:bg-slate-50"
          >
            Ver carrinho
          </Link>
          <button
            disabled
            className="w-full cursor-not-allowed rounded-md bg-slate-200 py-3 font-medium text-slate-500"
          >
            FINALIZAR COMPRA
          </button>
        </footer>
      </aside>
    </>
  );
}
