"use client";

import { useEffect, useRef } from "react";

// Verifica rápido nos primeiros minutos (quando a maioria confirma logo
// depois de pagar) e depois espaça as tentativas — usado por qualquer tela
// de resultado de pagamento que precise reconsultar o provedor (Pix, boleto
// e, no futuro, outros gateways) sem duplicar essa lógica em cada uma.
const FAST_POLL_INTERVAL_MS = 4000;
const FAST_POLL_DURATION_MS = 3 * 60 * 1000;
const SLOW_POLL_INTERVAL_MS = 15000;
const MAX_ACTIVE_POLL_DURATION_MS = 30 * 60 * 1000;

interface UsePaymentStatusPollingOptions {
  enabled: boolean;
  onTick: (signal: AbortSignal) => Promise<"stop" | void>;
  fastIntervalMs?: number;
  slowIntervalMs?: number;
  maxDurationMs?: number;
}

// `onTick` guardado em ref (em vez de dependência do efeito) para que trocar
// de callback a cada renderização não reinicie o ciclo de polling — só
// `enabled` controla quando o polling começa/para.
export function usePaymentStatusPolling({
  enabled,
  onTick,
  fastIntervalMs = FAST_POLL_INTERVAL_MS,
  slowIntervalMs = SLOW_POLL_INTERVAL_MS,
  maxDurationMs = MAX_ACTIVE_POLL_DURATION_MS,
}: UsePaymentStatusPollingOptions): void {
  const onTickRef = useRef(onTick);
  useEffect(() => {
    onTickRef.current = onTick;
  });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: number;
    let controller: AbortController | null = null;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled || Date.now() - startedAt >= maxDurationMs) return;
      if (document.hidden) {
        timer = window.setTimeout(poll, slowIntervalMs);
        return;
      }
      let result: "stop" | void = undefined;
      controller = new AbortController();
      try {
        result = await onTickRef.current(controller.signal);
      } catch {
        // Falha de rede não interrompe o polling — tenta de novo no próximo ciclo.
      }
      if (cancelled || result === "stop") return;
      const nextInterval =
        Date.now() - startedAt < FAST_POLL_DURATION_MS
          ? fastIntervalMs
          : slowIntervalMs;
      timer = window.setTimeout(poll, nextInterval);
    };

    const handleVisibilityChange = () => {
      if (!document.hidden && !cancelled) {
        window.clearTimeout(timer);
        void poll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    timer = window.setTimeout(poll, fastIntervalMs);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, fastIntervalMs, slowIntervalMs, maxDurationMs]);
}
