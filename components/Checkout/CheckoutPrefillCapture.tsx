"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  hasCheckoutPrefillParams,
  parseCheckoutPrefillParams,
  stripCheckoutPrefillParams,
} from "@/lib/commerce/checkoutPrefill";
import { storeCheckoutPrefill } from "@/lib/commerce/checkoutPrefillStorage";

// Em qualquer página: se o link trouxe dados de pré-preenchimento (`nome`,
// `whatsapp`, `cep`…), guarda os valores válidos na sessão da aba e tira esses
// parâmetros da URL, para o dado pessoal não ficar no histórico, em compartilhamentos
// nem em relatórios de analytics. UTM e demais parâmetros continuam. Não
// renderiza nada.
export function CheckoutPrefillCapture() {
  const pathname = usePathname();

  useEffect(() => {
    const { search, pathname: currentPath, hash } = window.location;
    if (!hasCheckoutPrefillParams(search)) return;

    const prefill = parseCheckoutPrefillParams(new URLSearchParams(search));
    if (prefill) storeCheckoutPrefill(prefill);

    window.history.replaceState(
      window.history.state,
      "",
      `${currentPath}${stripCheckoutPrefillParams(search)}${hash}`,
    );
  }, [pathname]);

  return null;
}
