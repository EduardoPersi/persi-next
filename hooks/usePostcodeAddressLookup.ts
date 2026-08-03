"use client";

import { useCallback, useRef } from "react";
import { normalizePostcode } from "@/lib/commerce/shippingCalculator";
import type { CartAddress } from "@/types/cart";

// Consulta isolada de endereço por CEP (app/api/shipping/postcode), que só
// reaproveita o mesmo serviço já usado pelo cálculo de frete
// (services/shipping/postcode.ts -> ViaCEP) sem disparar um cálculo de
// frete completo. Se o CEP não for encontrado, resolve para `null` — quem
// chamar decide como tratar (nunca trava a tela com erro).
export function usePostcodeAddressLookup() {
  const lastLookedUpDigits = useRef("");

  return useCallback(async (postcode: string): Promise<CartAddress | null> => {
    const digits = normalizePostcode(postcode);
    if (digits.length !== 8 || digits === lastLookedUpDigits.current) return null;
    lastLookedUpDigits.current = digits;

    try {
      const response = await fetch("/api/shipping/postcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcode: digits }),
        cache: "no-store",
      });
      if (!response.ok) return null;
      const body = (await response.json().catch(() => null)) as
        | { address?: CartAddress | null }
        | null;
      return body?.address ?? null;
    } catch {
      return null;
    }
  }, []);
}
