"use client";

import { useCallback, useEffect, useState } from "react";
import { readShippingCache } from "@/lib/commerce/shippingCalculator";
import { FreeShippingBadge } from "./FreeShippingBadge";

export function ProductFreeShippingNotice({ contextKey }: { contextKey: string }) {
  const [state, setState] = useState<"initial" | "eligible" | "ineligible">("initial");
  const update = useCallback(() => {
    const cached = readShippingCache(window.localStorage, contextKey);
    if (!cached) return setState("initial");
    const eligible = cached.quote.packages.some((shippingPackage) =>
      shippingPackage.rates.some((rate) =>
        rate.methodId !== "local_pickup" &&
        (rate.methodId === "free_shipping" ||
          rate.methodId === "advanced_free_shipping" ||
          Number(rate.price.value) === 0),
      ),
    );
    setState(eligible ? "eligible" : "ineligible");
  }, [contextKey]);
  useEffect(() => {
    queueMicrotask(update);
    window.addEventListener("persi:shipping-cache", update);
    return () => window.removeEventListener("persi:shipping-cache", update);
  }, [update]);
  if (state === "ineligible") return null;
  return <div className="mt-3"><FreeShippingBadge label={state === "eligible" ? "Frete Grátis para o CEP informado" : "Frete Grátis para todo o Brasil"} /></div>;
}
