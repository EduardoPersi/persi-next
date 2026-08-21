"use client";

import { useState } from "react";
import { useCart } from "@/hooks/useCart";
import { Button } from "@/components/UI/Button";

export function CheckoutCoupon() {
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

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="coupon-title">
      <h3 id="coupon-title" className="text-sm font-semibold text-slate-900">Cupom</h3>
      <div className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="checkout-coupon">Código do cupom</label>
        <input
          id="checkout-coupon"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          maxLength={64}
          autoComplete="off"
          placeholder="Digite o código"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <Button type="button" variant="outline" disabled={!code.trim() || isCheckoutUpdating} onClick={() => void apply()}>
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
    </section>
  );
}
