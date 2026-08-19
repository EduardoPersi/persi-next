"use client";

import { useEffect, useState } from "react";

export function useFlashDeals(endsAt: string) {
  const endTime = new Date(endsAt).getTime();
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(0, Math.ceil((endTime - Date.now()) / 1000)),
  );

  useEffect(() => {
    const update = () => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) window.location.reload();
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [endTime]);

  return {
    minutes: Math.floor(remainingSeconds / 60),
    seconds: remainingSeconds % 60,
    remainingSeconds,
  };
}
