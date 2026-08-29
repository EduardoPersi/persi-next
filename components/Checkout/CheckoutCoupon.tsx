"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useCart } from "@/hooks/useCart";
import { Button } from "@/components/UI/Button";

interface CheckoutCouponProps {
  idSuffix?: string;
  embedded?: boolean;
}

export function CheckoutCoupon({
  idSuffix = "default",
  embedded = false,
}: CheckoutCouponProps) {
  const { cart, applyCoupon, removeCoupon, isCheckoutUpdating } = useCart();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  const apply = async () => {
    const normalized = code.trim();
    if (!normalized || isCheckoutUpdating) return;
    const result = await applyCoupon(normalized);
    setMessage(result.message);
    if (result.success) setCode("");
  };

  const couponId = `checkout-coupon-${idSuffix}`;
  const titleId = `coupon-title-${idSuffix}`;

  const content = (
    <>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={couponId}>Código do cupom</label>
        <input
          id={couponId}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          maxLength={64}
          autoComplete="off"
          placeholder="Ex.: DESCONTO10"
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <Button type="button" disabled={!code.trim() || isCheckoutUpdating} onClick={() => void apply()}>
          Aplicar
        </Button>
      </div>
      {cart?.coupons.length ? (
        <ul className="mt-3 space-y-2">
          {cart.coupons.map((coupon) => (
            <li key={coupon.code} className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-emerald-700">{coupon.code}</span>
              <button
                type="button"
                disabled={isCheckoutUpdating}
                onClick={() => void removeCoupon(coupon.code).then((result) => setMessage(result.message))}
                className="min-h-11 text-red-700 underline-offset-4 hover:underline disabled:opacity-50"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? <p className="mt-2 text-xs text-slate-600" role="status">{message}</p> : null}
    </>
  );

  if (embedded) {
    return (
      <details
        className="group rounded-lg border border-secondary/25 bg-white"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm text-slate-700 marker:content-none">
          <span>Tenho um cupom de desconto</span>
          <ChevronDown
            size={18}
            aria-hidden="true"
            className="text-slate-400 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="border-t border-slate-200 p-2.5" aria-labelledby={titleId}>
          <h3 id={titleId} className="sr-only">Cupom de desconto</h3>
          {content}
        </div>
      </details>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby={titleId}>
      <h3 id={titleId} className="text-sm font-semibold text-slate-900">Cupom</h3>
      <div className="mt-3">{content}</div>
    </section>
  );
}
