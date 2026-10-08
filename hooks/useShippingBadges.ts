"use client";

import { useEffect, useMemo, useState } from "react";
import type { CheckoutShippingPackage } from "@/types/cart";
import {
  shippingBadgesForRates,
  type ShippingBadge,
} from "@/lib/shipping/shippingBadges";
import type { ArrivalDestination } from "@/lib/shipping/calendar/arrival";

// Selo de cada frete ("Mais barato", "Mais rápido"). Calculado só depois da
// tela carregar, como a previsão de chegada: o prazo depende do dia e da hora
// de agora, e o servidor (UTC) não pode divergir do navegador na hidratação.
// Devolve uma função: `badgeFor(packageId, rateId)`.
export function useShippingBadges(
  packages: readonly CheckoutShippingPackage[],
  destinationOverride?: ArrivalDestination,
) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    queueMicrotask(() => setNow(new Date()));
  }, []);

  const badges = useMemo(() => {
    const byPackage = new Map<string, Record<string, ShippingBadge>>();
    if (!now) return byPackage;
    for (const shippingPackage of packages) {
      const destination: ArrivalDestination = destinationOverride ?? {
        postcode: shippingPackage.destination?.postcode,
        city: shippingPackage.destination?.city,
        uf: shippingPackage.destination?.state,
      };
      byPackage.set(
        String(shippingPackage.packageId),
        shippingBadgesForRates(shippingPackage.rates, destination, now),
      );
    }
    return byPackage;
  }, [packages, destinationOverride, now]);

  return (packageId: number | string, rateId: string): ShippingBadge | undefined =>
    badges.get(String(packageId))?.[rateId];
}
