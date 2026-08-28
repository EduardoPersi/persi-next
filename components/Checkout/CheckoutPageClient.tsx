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
import type { PublicCheckoutCapabilities } from "@/lib/commerce/checkoutConfig";

interface CheckoutPageClientProps {
  initialProfile: CustomerWorkspaceProfile | null;
  initialAddresses: CustomerWorkspaceAddress[];
  initialGuestEmail?: string;
  capabilities: PublicCheckoutCapabilities;
}

export function CheckoutPageClient({
  initialProfile,
  initialAddresses,
  initialGuestEmail,
  capabilities,
}: CheckoutPageClientProps) {
  const { cart, error, isHydrated, isLoading } = useCart();
  // Compartilhado entre o formulário (seletor de pagamento) e o resumo do
  // pedido (coluna lateral no desktop) para que o desconto por forma de
  // pagamento apareça no Total dos dois lugares ao mesmo tempo.
  const [paymentMethod, setPaymentMethod] =
    useState<CheckoutPaymentMethod>(
      capabilities.pix
        ? "inter_pix"
        : capabilities.boleto
          ? "inter_boleto"
          : "mercadopago_card",
    );
  // Assim que o pedido é criado, o carrinho é esvaziado (ver
  // CheckoutForm/refreshCart) — sem essa flag, um carrinho com 0 itens faria
  // esta página achar que "o carrinho está vazio" e trocar a tela pela de
  // carrinho vazio, derrubando o QR Code do Pix (ou o boleto) que acabou de
  // aparecer.
  const [hasCreatedOrder, setHasCreatedOrder] = useState(false);
  const viewState = resolveCheckoutViewState({
    cart,
    error,
    isHydrated,
    isLoading,
  });

  if (!hasCreatedOrder) {
    if (viewState === "loading") return <CheckoutLoading />;
    if (viewState === "error") return <CheckoutError />;
    if (viewState === "empty") return <CheckoutEmptyCart />;
  }
  if (!cart) return <CheckoutError />;

  return (
    <div
      className={
        hasCreatedOrder ? undefined : "grid gap-6 lg:grid-cols-3 lg:items-start"
      }
    >
      <div className={hasCreatedOrder ? undefined : "lg:col-span-2"}>
        <CheckoutForm
          initialProfile={initialProfile}
          initialAddresses={initialAddresses}
          initialGuestEmail={initialGuestEmail}
          paymentMethod={paymentMethod}
          onPaymentMethodChange={setPaymentMethod}
          hasCreatedOrder={hasCreatedOrder}
          onOrderCreated={() => setHasCreatedOrder(true)}
          capabilities={capabilities}
        />
      </div>
      {!hasCreatedOrder ? (
        <div className="hidden lg:block">
          <CheckoutOrderSummary cart={cart} paymentMethod={paymentMethod} />
        </div>
      ) : null}
    </div>
  );
}
