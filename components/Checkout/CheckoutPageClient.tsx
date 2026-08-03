"use client";

import { useCart } from "@/hooks/useCart";
import { resolveCheckoutViewState } from "@/lib/commerce/checkout";
import { CheckoutForm } from "./CheckoutForm";
import { CheckoutOrderSummary } from "./CheckoutOrderSummary";
import {
  CheckoutEmptyCart,
  CheckoutError,
  CheckoutLoading,
} from "./CheckoutStates";

export function CheckoutPageClient() {
  const { cart, error, isHydrated, isLoading } = useCart();
  const viewState = resolveCheckoutViewState({
    cart,
    error,
    isHydrated,
    isLoading,
  });

  if (viewState === "loading") return <CheckoutLoading />;
  if (viewState === "error") return <CheckoutError />;
  if (viewState === "empty") return <CheckoutEmptyCart />;
  if (!cart) return <CheckoutError />;

  return (
    <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
      <div className="lg:col-span-2">
        <CheckoutForm />
      </div>
      <CheckoutOrderSummary cart={cart} />
    </div>
  );
}
