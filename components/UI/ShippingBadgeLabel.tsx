import clsx from "clsx";
import {
  SHIPPING_BADGE_LABEL,
  type ShippingBadge,
} from "@/lib/shipping/shippingBadges";

interface ShippingBadgeLabelProps {
  badge: ShippingBadge | undefined;
}

// Selo pequeno ao lado do nome do frete. Verde suave para "Mais barato" (como
// o desconto no Pix) e laranja suave (secundária) para "Mais rápido".
export function ShippingBadgeLabel({ badge }: ShippingBadgeLabelProps) {
  if (!badge) return null;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4",
        badge === "fastest"
          ? "bg-secondary/10 text-secondary-hover"
          : "bg-emerald-50 text-emerald-700",
      )}
    >
      {SHIPPING_BADGE_LABEL[badge]}
    </span>
  );
}
