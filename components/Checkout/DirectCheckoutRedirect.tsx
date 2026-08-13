"use client";

import { useEffect, useRef } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/UI/Button";
import { useCart } from "@/hooks/useCart";
import { useCheckoutTransfer } from "@/hooks/useCheckoutTransfer";
import { resolveCheckoutViewState } from "@/lib/commerce/checkout";
import { CheckoutEmptyCart, CheckoutError, CheckoutLoading } from "./CheckoutStates";

// Pula as etapas de Perfil/Endereço do Next.js: assim que o carrinho estiver
// pronto, já dispara a transferência para o checkout nativo do WooCommerce,
// que coleta contato e endereço do zero. CheckoutForm/CheckoutPageClient
// continuam existindo (não foram apagados) para uma eventual reativação do
// pré-preenchimento, só não são mais usados nesta página.
export function DirectCheckoutRedirect() {
  const { cart, error, isHydrated, isLoading } = useCart();
  const { checkoutError, isPreparingCheckout, prepareCheckout } =
    useCheckoutTransfer();
  const viewState = resolveCheckoutViewState({ cart, error, isHydrated, isLoading });
  const hasStarted = useRef(false);

  useEffect(() => {
    if (viewState !== "ready" || hasStarted.current) return;
    hasStarted.current = true;
    void prepareCheckout();
  }, [viewState, prepareCheckout]);

  if (viewState === "loading") return <CheckoutLoading />;
  if (viewState === "error") return <CheckoutError />;
  if (viewState === "empty") return <CheckoutEmptyCart />;

  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      {checkoutError ? (
        <>
          <p role="status" className="text-sm text-red-700">
            {checkoutError}
          </p>
          <Button
            className="mt-5 w-full"
            disabled={isPreparingCheckout}
            onClick={() => {
              hasStarted.current = true;
              void prepareCheckout();
            }}
          >
            <Lock className="h-4 w-4" aria-hidden="true" />
            Tentar novamente
          </Button>
        </>
      ) : (
        <p role="status" aria-live="polite" className="text-sm text-slate-600">
          Preparando seu checkout…
        </p>
      )}
    </div>
  );
}
