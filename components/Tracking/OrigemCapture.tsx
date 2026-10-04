"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useCookieConsent } from "@/hooks/useCookieConsent";
import { registrarVisita } from "@/lib/tracking/navegador";

/**
 * Captura a origem da visita (UTM, gclid etc.) e grava os cookies de primeiro e
 * último toque. Não renderiza nada: não há layout a deslocar.
 *
 * Roda de novo quando a rota ou o consentimento mudam:
 *  - rota: uma navegação interna pode trazer UTM novo (ex.: link de e-mail);
 *  - consentimento: aceitar os cookies no meio da visita grava, agora de forma
 *    persistente, o que antes só ficava em sessão (ver lib/tracking/origem.ts).
 */
function Capturador() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { consent } = useCookieConsent();
  const query = searchParams.toString();

  useEffect(() => {
    registrarVisita(consent);
  }, [pathname, query, consent]);

  return null;
}

export function OrigemCapture() {
  // useSearchParams exige Suspense; sem isso, páginas estáticas deixariam de
  // ser pré-renderizadas. Mesmo padrão do AnalyticsPageView.
  return (
    <Suspense fallback={null}>
      <Capturador />
    </Suspense>
  );
}
