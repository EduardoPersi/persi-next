"use client";

import { useState } from "react";
import { useCart } from "@/hooks/useCart";
import { resolveCheckoutViewState } from "@/lib/commerce/checkout";
import type {
  CustomerWorkspaceAddress,
  CustomerWorkspaceProfile,
} from "@/lib/customer-workspace/types";
import { CheckoutForm } from "./CheckoutForm";
import { CheckoutOrderSummary } from "./CheckoutOrderSummary";
import type { CheckoutPaymentMethod } from "./paymentMethod";
import {
  CheckoutEmptyCart,
  CheckoutError,
  CheckoutLoading,
} from "./CheckoutStates";

interface CheckoutPageClientProps {
  initialProfile: CustomerWorkspaceProfile | null;
  initialAddresses: CustomerWorkspaceAddress[];
}

export function CheckoutPageClient({
  initialProfile,
  initialAddresses,
}: CheckoutPageClientProps) {
  const { cart, error, isHydrated, isLoading } = useCart();
  // Compartilhado entre o formulário (seletor de pagamento) e o resumo do
  // pedido (coluna lateral no desktop) para que o desconto por forma de
  // pagamento apareça no Total dos dois lugares ao mesmo tempo.
  const [paymentMethod, setPaymentMethod] =
    useState<CheckoutPaymentMethod>("inter_pix");
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
        <CheckoutForm
          initialProfile={initialProfile}
          initialAddresses={initialAddresses}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
        />
      </div>
      <div className="hidden lg:block">
        <CheckoutOrderSummary cart={cart} paymentMethod={paymentMethod} />
      </div>
    </div>
  );
}
