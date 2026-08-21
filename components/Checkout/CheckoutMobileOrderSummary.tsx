"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { ProductQuantity } from "@/components/Product/ProductQuantity";
import { useCart } from "@/hooks/useCart";
import { formatStoreMoney, isZeroMoney, moneyToNumber } from "@/lib/formatting/money";
import type { Cart } from "@/types/cart";
import {
  getPaymentMethodDiscountRate,
  type CheckoutPaymentMethod,
} from "./paymentMethod";

const FALLBACK_IMAGE =
  "/images/brand/persi-materiais-eletricos-e-hidraulicos-ferramentas.webp";

interface CheckoutMobileOrderSummaryProps {
  cart: Cart;
  paymentMethod?: CheckoutPaymentMethod;
}

// Versão compacta e recolhível do resumo do pedido, só para mobile — o
// desktop continua usando CheckoutOrderSummary como barra lateral sempre
// visível. Mantida como componente separado (em vez de variantes dentro do
// mesmo componente) para não misturar os dois layouts bem diferentes.
export function CheckoutMobileOrderSummary({
  cart,
  paymentMethod,
}: CheckoutMobileOrderSummaryProps) {
  const hasSelectedShippingRate = cart.shippingPackages.length > 0 &&
    cart.shippingPackages.every((shippingPackage) =>
      shippingPackage.rates.some((rate) => rate.selected),
    );
  const { updateItem, pendingItemKey } = useCart();
  const [isExpanded, setIsExpanded] = useState(false);
  const formatter = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: cart.currencyCode,
  });
  const priceTotal = moneyToNumber(cart.totals.price);
  const discountRate = paymentMethod
    ? getPaymentMethodDiscountRate(paymentMethod)
    : 0;
  const paymentDiscount = priceTotal * discountRate;
  const finalTotal = priceTotal - paymentDiscount;

  return (
    <div className="rounded-xl border border-black bg-white lg:hidden">
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        aria-expanded={isExpanded}
        aria-controls="checkout-mobile-summary-panel"
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <ChevronDown
            size={16}
            className={clsx(
              "shrink-0 text-slate-500 transition-transform",
              isExpanded && "rotate-180",
            )}
            aria-hidden="true"
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            Seu pedido
            <span className="ml-1 font-normal normal-case text-slate-500">
              · {cart.itemsCount} {cart.itemsCount === 1 ? "item" : "itens"}
            </span>
          </span>
        </span>
        <strong className="text-sm text-[#0c2d72]">
          {formatter.format(finalTotal)}
        </strong>
      </button>

      {isExpanded ? (
        <div
          id="checkout-mobile-summary-panel"
          className="border-t border-slate-200 px-4 py-4"
        >
          <ul className="divide-y divide-slate-200">
            {cart.items.map((item) => {
              const isPending = pendingItemKey === item.key;
              return (
                <li key={item.key} className="flex gap-3 py-3 first:pt-0">
                  <Image
                    src={item.image?.src || FALLBACK_IMAGE}
                    alt={item.image?.alt || item.name}
                    width={56}
                    height={56}
                    className="h-14 w-14 shrink-0 rounded-lg border border-slate-200 object-contain"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold leading-5 text-slate-900">
                      {item.name}
                    </p>
                    {item.variation.length ? (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {item.variation
                          .map(({ label, value }) => `${label}: ${value}`)
                          .join(" · ")}
                      </p>
                    ) : null}
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="w-24">
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
                          showLabel={false}
                        />
                      </div>
                      <strong className="text-xs text-slate-900">
                        {formatter.format(item.total)}
                      </strong>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <dl className="mt-4 space-y-2 border-t border-slate-200 pt-4 text-xs">
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
            {paymentDiscount > 0 ? (
              <div className="flex justify-between gap-4 text-emerald-700">
                <dt>Desconto por forma de pagamento</dt>
                <dd>-{formatter.format(paymentDiscount)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Entrega</dt>
              <dd className="max-w-40 text-right text-slate-600">
                {cart.hasCalculatedShipping && hasSelectedShippingRate
                  ? isZeroMoney(cart.totals.shipping)
                    ? "Grátis"
                    : formatStoreMoney(cart.totals.shipping)
                  : "A calcular"}
              </dd>
            </div>
            {!isZeroMoney(cart.totals.tax) ? (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Impostos</dt>
                <dd>{formatStoreMoney(cart.totals.tax)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4 border-t border-slate-200 pt-3">
              <dt className="font-bold text-slate-900">Total</dt>
              <dd className="text-sm font-bold text-[#0c2d72]">
                {formatter.format(finalTotal)}
              </dd>
            </div>
          </dl>

          <Link
            href="/carrinho"
            className="mt-4 inline-block text-xs font-medium text-primary underline underline-offset-2"
          >
            Editar carrinho
          </Link>
        </div>
      ) : null}
    </div>
  );
}
