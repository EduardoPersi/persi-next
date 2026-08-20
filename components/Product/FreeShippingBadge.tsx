"use client";

import { useEffect, useRef } from "react";
import { Truck } from "lucide-react";
import { pushToDataLayer } from "@/lib/analytics/gtm";

export function FreeShippingBadge({
  compact = false,
  label = "Frete Grátis",
}: {
  compact?: boolean;
  label?: string;
}) {
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
    <span
      ref={ref}
      className={`inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 font-semibold text-emerald-700 shadow-sm ${compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"}`}
    >
      <Truck
        className={compact ? "h-3.5 w-3.5" : "h-4 w-4"}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
