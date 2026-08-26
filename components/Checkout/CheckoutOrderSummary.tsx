import Image from "next/image";
import Link from "next/link";
import { formatStoreMoney, isZeroMoney } from "@/lib/formatting/money";
import type { Cart } from "@/types/cart";
import { QuantitySelect } from "@/components/UI/QuantitySelect";
import { AnimatedValue } from "@/components/UI/AnimatedValue";
import { CheckoutCoupon } from "./CheckoutCoupon";
import {
  getCartPaymentTotals,
  type CheckoutPaymentMethod,
} from "./paymentMethod";

const FALLBACK_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

interface CheckoutOrderSummaryProps {
  cart: Cart;
  paymentMethod?: CheckoutPaymentMethod;
}

export function CheckoutOrderSummary({
  cart,
  paymentMethod,
}: CheckoutOrderSummaryProps) {
  const hasSelectedShippingRate = cart.shippingPackages.length > 0 &&
    cart.shippingPackages.every((shippingPackage) =>
      shippingPackage.rates.some((rate) => rate.selected),
    );
  const formatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: cart.currencyCode,
  });
  const { paymentDiscount, finalTotal } = getCartPaymentTotals(
    paymentMethod ?? "pagbank_card",
    cart,
  );

  return (
    <aside
      aria-labelledby="checkout-summary-title"
      className="rounded-xl border border-blue-200 bg-white p-5 shadow-[0_8px_24px_rgba(59,130,246,0.10)] lg:sticky lg:top-6"
    >
      <Link
        href="/carrinho"
        aria-label="Editar carrinho"
        className="flex items-center gap-2 rounded-lg transition-colors hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-xs font-bold text-white"
          aria-hidden="true"
        >
          4
        </span>
        <h2 id="checkout-summary-title" className="text-base font-bold text-slate-950">
          Revise seu pedido
        </h2>
      </Link>

      <div className="mt-4">
        <CheckoutCoupon idSuffix="desktop-summary" embedded />
      </div>

      <ul className="mt-4 divide-y divide-slate-200">
        {cart.items.map((item) => (
          <li key={item.key} className="flex gap-3 py-3 first:pt-0">
            <Image
              src={item.image?.src || FALLBACK_IMAGE}
              alt={item.image?.alt || item.name}
              width={48}
              height={48}
              className="h-12 w-12 shrink-0 border border-slate-200 object-contain"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold leading-5 text-slate-900">
                {item.name}
              </p>
              {item.variation.length ? (
                <p className="mt-1 text-xs text-slate-500">
                  {item.variation
                    .map(({ label, value }) => `${label}: ${value}`)
                    .join(" · ")}
                </p>
              ) : null}
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <QuantitySelect item={item} idSuffix="checkout-desktop" />
                <strong>
                  <AnimatedValue animationKey={item.total}>
                    {formatter.format(item.total)}
                  </AnimatedValue>
                </strong>
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
            <AnimatedValue animationKey={cart.totals.items.value}>
              {formatStoreMoney(cart.totals.items)}
            </AnimatedValue>
          </dd>
        </div>
        {!isZeroMoney(cart.totals.discount) || cart.coupons.length ? (
          <div className="checkout-discount-enter flex justify-between gap-4 text-emerald-700">
            <dt>
              Descontos
              {cart.coupons.length
                ? ` (${cart.coupons.map(({ code }) => code).join(", ")})`
                : ""}
            </dt>
            <dd>
              <AnimatedValue animationKey={cart.totals.discount.value}>
                -{formatStoreMoney(cart.totals.discount)}
              </AnimatedValue>
            </dd>
          </div>
        ) : null}
        {paymentDiscount > 0 ? (
          <div className="checkout-discount-enter flex justify-between gap-4 text-emerald-700">
            <dt>Desconto por forma de pagamento</dt>
            <dd>
              <AnimatedValue animationKey={paymentDiscount}>
                -{formatter.format(paymentDiscount)}
              </AnimatedValue>
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Entrega</dt>
          <dd className="max-w-52 text-right text-slate-600">
            {cart.hasCalculatedShipping && hasSelectedShippingRate
              ? isZeroMoney(cart.totals.shipping)
                ? "Grátis"
                : formatStoreMoney(cart.totals.shipping)
              : "A calcular"}
          </dd>
        </div>
        {cart.fees.map((fee) => (
          <div key={fee.key} className="flex justify-between gap-4">
            <dt className="text-slate-600">{fee.name}</dt>
            <dd>{formatStoreMoney(fee.total)}</dd>
          </div>
        ))}
        {!isZeroMoney(cart.totals.tax) ? (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Impostos</dt>
            <dd>{formatStoreMoney(cart.totals.tax)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 border-t border-slate-200 pt-4">
          <dt className="font-bold text-emerald-700">Total</dt>
          <dd className="text-lg font-bold text-emerald-700">
            <AnimatedValue animationKey={finalTotal}>
              {formatter.format(finalTotal)}
            </AnimatedValue>
          </dd>
        </div>
      </dl>
    </aside>
  );
}
