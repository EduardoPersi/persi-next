"use client";

import { useFlashDeals } from "@/hooks/useFlashDeals";

export function FlashDealsTimer({ endsAt }: { endsAt: string }) {
  const { minutes, seconds } = useFlashDeals(endsAt);
  const time = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-2 text-sm text-slate-700">
      <span>Termina em</span>
      <time
        dateTime={endsAt}
        className="min-w-16 rounded-lg bg-[#071f5c] px-2.5 py-1.5 text-center font-bold tabular-nums text-white"
        aria-label={`A oferta termina em ${minutes} minutos e ${seconds} segundos`}
      >
        {time}
      </time>
    </div>
  );
}
