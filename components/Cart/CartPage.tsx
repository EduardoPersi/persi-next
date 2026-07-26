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
                className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 p-4 md:grid-cols-[112px_minmax(0,1fr)_auto] md:gap-4 md:rounded-xl md:border md:border-slate-200 md:bg-white md:p-5"
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
                      className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900 hover:text-[#ff6a00] md:text-base"
                    >
                      {item.name}
                    </Link>
                  ) : (
                    <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900 md:text-base">
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
                  </dl>
                  <div className="mt-4 hidden md:flex md:items-end">
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
                  </div>
                </div>
                <div className="col-span-2 flex flex-col items-end gap-1 border-t border-slate-100 pt-3 md:col-span-1 md:min-w-32 md:justify-between md:border-0 md:pt-0">
                  <button
                    type="button"
                    onClick={() => void removeItem(item.key)}
                    disabled={isPending}
                    aria-label={`Remover ${item.name} do carrinho`}
                    className="inline-flex min-h-11 w-auto items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-wait disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{isPending ? "Removendo..." : "Remover"}</span>
                  </button>
                  <p className="whitespace-nowrap font-bold text-[#0c2d72] md:text-slate-900">
                    <span className="mr-2 font-normal text-slate-500 md:hidden">
                      Subtotal:
                    </span>
                    {formatter.format(item.total)}
                  </p>
                </div>
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
