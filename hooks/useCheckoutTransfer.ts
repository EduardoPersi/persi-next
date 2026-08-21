"use client";

import { useCallback, useRef, useState } from "react";
import type { CheckoutFormValues } from "@/types/checkout";

export function useCheckoutTransfer() {
  const [isPreparingCheckout, setIsPreparingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const isNavigating = useRef(false);

  const prepareCheckout = useCallback(
    async (_formValues?: CheckoutFormValues, onBeforeRedirect?: () => void) => {
      if (isNavigating.current) return;

	  isNavigating.current = true;

      setIsPreparingCheckout(true);
      setCheckoutError("");

      try {
        onBeforeRedirect?.();
		// O checkout principal é Next.js. O fluxo híbrido permanece acessível
		// apenas por /checkout/hybrid para rollback operacional manual.
		window.location.assign("/checkout");
      } catch {
        setCheckoutError(
          "Não foi possível preparar o checkout. Tente novamente.",
        );
      } finally {
		isNavigating.current = false;
        setIsPreparingCheckout(false);
      }
    },
    [],
  );

  return { checkoutError, isPreparingCheckout, prepareCheckout };
}
