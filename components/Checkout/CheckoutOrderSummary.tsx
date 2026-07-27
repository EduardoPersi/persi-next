import Image from "next/image";
import Link from "next/link";
import { formatStoreMoney, isZeroMoney } from "@/lib/formatting/money";
import type { Cart } from "@/types/cart";

const FALLBACK_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

export function CheckoutOrderSummary({ cart }: { cart: Cart }) {
  const formatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: cart.currencyCode,
  });

  return (
    <aside
      aria-labelledby="checkout-summary-title"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-6 sm:p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="checkout-summary-title" className="text-xl text-[#0c2d72]">
          Resumo do pedido
        </h2>
        <Link
          href="/carrinho"
          className="shrink-0 text-sm font-medium text-primary underline underline-offset-2"
        >
          Editar carrinho
        </Link>
      </div>

      <ul className="mt-5 divide-y divide-slate-200">
        {cart.items.map((item) => (
          <li key={item.key} className="flex gap-3 py-4 first:pt-0">
            <Image
              src={item.image?.src || FALLBACK_IMAGE}
              alt={item.image?.alt || item.name}
              width={64}
              height={64}
              className="h-16 w-16 shrink-0 rounded-lg border border-slate-200 object-contain"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-5 text-slate-900">
                {item.name}
              </p>
              {item.variation.length ? (
                <p className="mt-1 text-xs text-slate-500">
                  {item.variation
                    .map(({ label, value }) => `${label}: ${value}`)
                    .join(" · ")}
                </p>
              ) : null}
              <div className="mt-2 flex justify-between gap-3 text-sm">
                <span className="text-slate-600">
                  Quantidade: {item.quantity}
                </span>
                <strong>{formatter.format(item.total)}</strong>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <dl
        className="space-y-3 border-t border-slate-200 pt-4 text-sm"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Subtotal</dt>
          <dd className="font-semibold">
            {formatStoreMoney(cart.totals.items)}
          </dd>
        </div>
        {!isZeroMoney(cart.totals.discount) || cart.coupons.length ? (
          <div className="flex justify-between gap-4 text-emerald-700">
            <dt>
              Descontos
              {cart.coupons.length
                ? ` (${cart.coupons.map(({ code }) => code).join(", ")})`
                : ""}
            </dt>
            <dd>-{formatStoreMoney(cart.totals.discount)}</dd>
          </div>
        ) : null}
        {cart.fees.map((fee) => (
          <div key={fee.key} className="flex justify-between gap-4">
            <dt className="text-slate-600">{fee.name}</dt>
            <dd>{formatStoreMoney(fee.total)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Entrega</dt>
          <dd className="max-w-52 text-right text-slate-600">
            {cart.hasCalculatedShipping
              ? isZeroMoney(cart.totals.shipping)
                ? "Grátis"
                : formatStoreMoney(cart.totals.shipping)
              : "Informe o endereço para calcular."}
          </dd>
        </div>
        {!isZeroMoney(cart.totals.tax) ? (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Impostos</dt>
            <dd>{formatStoreMoney(cart.totals.tax)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 border-t border-slate-200 pt-4">
          <dt className="font-bold text-slate-900">Total</dt>
          <dd className="text-lg font-bold text-[#0c2d72]">
            {formatStoreMoney(cart.totals.price)}
          </dd>
        </div>
      </dl>
    </aside>
  );
}
