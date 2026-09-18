"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";

function subscribeToClock(onChange: () => void) {
  const timer = window.setInterval(onChange, 1000);
  return () => window.clearInterval(timer);
}

const getCurrentSecond = () => Math.floor(Date.now() / 1000);
const getServerSecond = () => null;

export function useFlashDeals(endsAt: string) {
  const endTime = new Date(endsAt).getTime();
  const router = useRouter();
  const refreshedEndTime = useRef<number | null>(null);
  const currentSecond = useSyncExternalStore(subscribeToClock, getCurrentSecond, getServerSecond);
  const remainingSeconds = currentSecond === null || !Number.isFinite(endTime)
    ? null
    : Math.max(0, Math.ceil(endTime / 1000) - currentSecond);

  useEffect(() => {
    if (remainingSeconds !== 0 || refreshedEndTime.current === endTime) return;
    refreshedEndTime.current = endTime;
    // Atualiza o lote sem descarregar o documento nem repetir a atualização
    // a cada segundo caso o servidor ainda devolva a mesma janela em cache.
    router.refresh();
  }, [endTime, remainingSeconds, router]);

  return {
    minutes: remainingSeconds === null ? null : Math.floor(remainingSeconds / 60),
    seconds: remainingSeconds === null ? null : remainingSeconds % 60,
    remainingSeconds,
  };
}
