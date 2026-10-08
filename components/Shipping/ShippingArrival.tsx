"use client";

import { useEffect, useState } from "react";
import {
  arrivalTextForRate,
  type ArrivalDestination,
  type ArrivalRate,
} from "@/lib/shipping/calendar/arrival";

interface ShippingArrivalProps {
  rate: ArrivalRate;
  destination: ArrivalDestination;
  className?: string;
}

// A previsão de chegada de uma opção de frete ("Chega quinta, dia 9"). Só é
// calculada depois da tela carregar: ela depende do dia e da hora de agora, e o
// servidor (UTC) não pode decidir isso por conta própria nem divergir do
// navegador na hidratação. Sem previsão possível (retirada, transportadora sem
// prazo), não mostra nada.
export function ShippingArrival({
  rate,
  destination,
  className = "mt-1 block text-sm font-medium leading-5 text-emerald-700",
}: ShippingArrivalProps) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    queueMicrotask(() => setNow(new Date()));
  }, []);

  if (!now) return null;
  const text = arrivalTextForRate(rate, destination, now);
  return text ? <span className={className}>{text}</span> : null;
}
