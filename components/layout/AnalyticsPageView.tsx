"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pushToDataLayer } from "@/lib/analytics/gtm";

// O GTM só recebe um page_view "de verdade" no carregamento inicial (o
// gtm.js só roda uma vez). Trocas de rota do App Router acontecem via
// history.pushState, sem reload — sem isto, GA4 nunca sabe que o usuário
// navegou de Home para Categoria/Produto/etc.
function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    const search = searchParams.toString();
    const pagePath = search ? `${pathname}?${search}` : pathname;
    if (lastTracked.current === pagePath) return;
    lastTracked.current = pagePath;

    pushToDataLayer({
      event: "page_view",
      page_path: pagePath,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname, searchParams]);

  return null;
}

export function AnalyticsPageView() {
  return (
    <Suspense fallback={null}>
      <PageViewTracker />
    </Suspense>
  );
}
