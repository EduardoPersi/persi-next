"use client";

import { useEffect, useRef } from "react";
import { Truck } from "lucide-react";
import { pushToDataLayer } from "@/lib/analytics/gtm";

export function FreeShippingBadge({ compact = false, label = "Frete Grátis" }: { compact?: boolean; label?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      pushToDataLayer({ event: "free_shipping_badge_view", free_shipping: true });
      observer.disconnect();
    }, { threshold: 0.5 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <span ref={ref} className={`inline-flex items-center gap-1 rounded-md bg-emerald-50 font-semibold text-emerald-700 ${compact ? "px-1.5 py-1 text-[10px]" : "px-2.5 py-1.5 text-sm"}`}>
      <Truck className={compact ? "h-3 w-3" : "h-4 w-4"} aria-hidden="true" />
      {label}
    </span>
  );
}
