"use client";

import { useCallback, useRef, useState } from "react";
import {
  CheckoutTransferRequestGate,
  requestCheckoutTransfer,
} from "@/lib/commerce/checkoutTransferClient";
import type { CheckoutFormValues } from "@/types/checkout";

export function useCheckoutTransfer() {
  const [isPreparingCheckout, setIsPreparingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const requestGate = useRef(new CheckoutTransferRequestGate());

  const prepareCheckout = useCallback(
    async (formValues: CheckoutFormValues, onBeforeRedirect?: () => void) => {
      if (!requestGate.current.tryStart()) return;

      setIsPreparingCheckout(true);
      setCheckoutError("");

      try {
        const transferUrl = await requestCheckoutTransfer(formValues);
        onBeforeRedirect?.();
        window.location.assign(transferUrl);
      } catch {
        setCheckoutError(
          "Não foi possível preparar o checkout. Tente novamente.",
        );
      } finally {
        requestGate.current.finish();
        setIsPreparingCheckout(false);
      }
    },
    [],
  );

  return { checkoutError, isPreparingCheckout, prepareCheckout };
}
