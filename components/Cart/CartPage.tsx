"use client";

import Image from "next/image";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useCart } from "@/hooks/useCart";
import { ProductQuantity } from "@/components/Product/ProductQuantity";

const FALLBACK_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

export function CartPage() {
  const {
    cart,
    error,
    isLoading,
    pendingItemKey,
    removeItem,
    updateItem,
  } = useCart();
  const formatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: cart?.currencyCode ?? "BRL",
  });

  if (isLoading && !cart) {
    return (
      <div
        className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600"
        role="status"
        aria-live="polite"
      >
        Carregando seu carrinho...
      </div>
    );
  }

  if (!cart?.items.length) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <h2 className="text-xl font-bold text-[#0c2d72]">
          Seu carrinho está vazio
        </h2>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-[#0c2d72] px-5 font-medium text-white transition hover:bg-[#17439f]"
        >
          Continuar comprando
        </Link>
      </section>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <section aria-labelledby="cart-items-title">
        <h2 id="cart-items-title" className="sr-only">
          Produtos no carrinho
        </h2>
        <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white md:space-y-4 md:divide-y-0 md:overflow-visible md:border-0 md:bg-transparent">
          {cart.items.map((item) => {
            const isPending = pendingItemKey === item.key;
            const productHref = item.slug ? `/produto/${item.slug}` : undefined;

            return (
              <article
                key={item.key}
                className="relative grid grid-cols-[72px_minmax(0,1fr)] gap-3 p-4 md:grid-cols-[112px_minmax(0,1fr)] md:gap-4 md:rounded-xl md:border md:border-slate-200 md:bg-white md:p-5"
              >
                <Image
                  src={item.image?.src || FALLBACK_IMAGE}
                  alt={item.image?.alt || item.name}
                  width={112}
                  height={112}
                  className="h-[72px] w-[72px] rounded-lg border border-slate-200 object-contain md:h-28 md:w-28 md:rounded-xl"
                />
                <div className="min-w-0">
                  {productHref ? (
                    <Link
                      href={productHref}
                      className="line-clamp-2 pr-7 text-sm font-semibold leading-5 text-slate-900 hover:text-[#ff6a00] md:pr-0 md:text-base"
                    >
                      {item.name}
                    </Link>
                  ) : (
                    <h3 className="line-clamp-2 pr-7 text-sm font-semibold leading-5 text-slate-900 md:pr-0 md:text-base">
                      {item.name}
                    </h3>
                  )}

                  {item.variation.length > 0 ? (
                    <dl className="mt-1 text-xs text-slate-600 md:mt-2 md:text-sm">
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

                  <p className="mt-3 hidden text-sm text-slate-600 md:block">
                    Preço unitário: {formatter.format(item.price)}
                  </p>
                  <dl className="mt-3 space-y-2 text-sm md:hidden">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Preço</dt>
                      <dd className="text-slate-600">
                        {formatter.format(item.price)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Quantidade</dt>
                      <dd className="w-28">
                        <ProductQuantity
                          value={item.quantity}
                          min={item.minQuantity}
                          max={item.maxQuantity}
                          step={item.quantityStep}
                          onChange={(quantity) => {
                            if (!isPending && quantity !== item.quantity) {
                              void updateItem(item.key, quantity);
                            }
                          }}
                          compact
                          dense
                          fullWidthOnMobile={false}
                          showLabel={false}
                        />
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-slate-500">Subtotal</dt>
                      <dd className="font-bold text-[#0c2d72]">
                        {formatter.format(item.total)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 hidden md:flex md:items-end md:justify-between">
                    <ProductQuantity
                      value={item.quantity}
                      min={item.minQuantity}
                      max={item.maxQuantity}
                      step={item.quantityStep}
                      onChange={(quantity) => {
                        if (!isPending && quantity !== item.quantity) {
                          void updateItem(item.key, quantity);
                        }
                      }}
                      fullWidthOnMobile={false}
                    />
                    <div className="text-right">
                      <p className="font-bold text-slate-900">
                        {formatter.format(item.total)}
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void removeItem(item.key)}
                  disabled={isPending}
                  aria-label={`Remover ${item.name} do carrinho`}
                  title="Remover produto"
                  className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-wait disabled:opacity-50 md:right-4 md:top-auto md:bottom-4 md:w-auto md:gap-1 md:rounded-md md:px-2 md:text-sm md:font-medium md:text-red-700"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="hidden md:inline">
                    {isPending ? "Removendo..." : "Remover"}
                  </span>
                </button>
              </article>
            );
          })}
        </div>
        <p className="mt-4 text-sm text-red-700" role="status" aria-live="polite">
          {error}
        </p>
      </section>

      <aside className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-[#0c2d72]">Resumo do pedido</h2>
        <div className="mt-5 flex items-center justify-between border-b border-slate-200 pb-4">
          <span className="text-slate-600">Subtotal dos produtos</span>
          <strong>{formatter.format(cart.subtotal)}</strong>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          Frete e descontos serão calculados no checkout.
        </p>
        <button
          type="button"
          disabled
          aria-describedby="checkout-status"
          className="mt-6 h-12 w-full cursor-not-allowed rounded-xl bg-slate-200 px-4 font-medium text-slate-500"
        >
          Ir para o checkout
        </button>
        <p id="checkout-status" className="mt-2 text-center text-sm text-slate-500">
          Checkout em implantação
        </p>
      </aside>
    </div>
  );
}
