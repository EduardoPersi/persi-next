"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { pushEcommerceEvent } from "@/lib/analytics/gtm";

interface Props {
  children: ReactNode;
  promotionId: string;
  promotionName: string;
}

export function FlashDealsAnalytics({ children, promotionId, promotionName }: Props) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const viewed = useRef(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || viewed.current) return;
        viewed.current = true;
        pushEcommerceEvent("view_promotion", {
          items: [{ promotion_id: promotionId, promotion_name: promotionName }],
        });
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [promotionId, promotionName]);

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const link = target.closest<HTMLElement>("[data-flash-deal-product]");
    if (!link) return;
    pushEcommerceEvent("select_promotion", {
      items: [{
        promotion_id: promotionId,
        promotion_name: promotionName,
        item_id: link.dataset.productId,
        item_name: link.dataset.productName,
      }],
    });
  }

  return <div ref={sectionRef} onClick={handleClick}>{children}</div>;
}
