"use client";

import { useEffect, useRef } from "react";

// Verifica rápido nos primeiros minutos (quando a maioria confirma logo
// depois de pagar) e depois espaça as tentativas — usado por qualquer tela
// de resultado de pagamento que precise reconsultar o provedor (Pix, boleto
// e, no futuro, outros gateways) sem duplicar essa lógica em cada uma.
const FAST_POLL_INTERVAL_MS = 4000;
const FAST_POLL_DURATION_MS = 3 * 60 * 1000;
const SLOW_POLL_INTERVAL_MS = 15000;

interface UsePaymentStatusPollingOptions {
  enabled: boolean;
  onTick: () => Promise<"stop" | void>;
}

// `onTick` guardado em ref (em vez de dependência do efeito) para que trocar
// de callback a cada renderização não reinicie o ciclo de polling — só
// `enabled` controla quando o polling começa/para.
export function usePaymentStatusPolling({
  enabled,
  onTick,
}: UsePaymentStatusPollingOptions): void {
  const onTickRef = useRef(onTick);
  useEffect(() => {
    onTickRef.current = onTick;
  });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: number;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled) return;
      let result: "stop" | void = undefined;
      try {
        result = await onTickRef.current();
      } catch {
        // Falha de rede não interrompe o polling — tenta de novo no próximo ciclo.
      }
      if (cancelled || result === "stop") return;
      const nextInterval =
        Date.now() - startedAt < FAST_POLL_DURATION_MS
          ? FAST_POLL_INTERVAL_MS
          : SLOW_POLL_INTERVAL_MS;
      timer = window.setTimeout(poll, nextInterval);
    };

    timer = window.setTimeout(poll, FAST_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);
}
