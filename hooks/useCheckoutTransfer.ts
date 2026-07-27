"use client";

import { useCallback, useRef, useState } from "react";
import {
  CheckoutTransferRequestGate,
  requestCheckoutTransfer,
} from "@/lib/commerce/checkoutTransferClient";

export function useCheckoutTransfer() {
  const [isPreparingCheckout, setIsPreparingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const requestGate = useRef(new CheckoutTransferRequestGate());

  const prepareCheckout = useCallback(async () => {
    if (!requestGate.current.tryStart()) return;

    setIsPreparingCheckout(true);
    setCheckoutError("");

    try {
      const transferUrl = await requestCheckoutTransfer();
      window.location.assign(transferUrl);
    } catch {
      setCheckoutError(
        "Não foi possível preparar o checkout. Tente novamente.",
      );
    } finally {
      requestGate.current.finish();
      setIsPreparingCheckout(false);
    }
  }, []);

  return { checkoutError, isPreparingCheckout, prepareCheckout };
}
