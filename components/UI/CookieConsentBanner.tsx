"use client";

import Link from "next/link";
import { useCookieConsent } from "@/hooks/useCookieConsent";
import { Button } from "@/components/UI/Button";

export function CookieConsentBanner() {
  const { bannerVisible, accept, decline } = useCookieConsent();

  if (!bannerVisible) return null;

  return (
    <div
      role="region"
      aria-label="Consentimento de cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] sm:px-6"
    >
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-6 text-slate-600">
          Usamos cookies para melhorar sua experiência de navegação e compra.
          Ao continuar, você concorda com nossa{" "}
          <Link
            href="/politica-de-privacidade-e-seguranca"
            className="font-medium text-primary underline underline-offset-2"
          >
            Política de Privacidade e Segurança
          </Link>
          .
        </p>
        <div className="flex w-full shrink-0 flex-col items-center gap-2 sm:w-auto sm:flex-row sm:gap-4">
          <Button variant="secondary" onClick={accept} className="w-full sm:w-auto">
            Concordo
          </Button>
          <button
            type="button"
            onClick={decline}
            className="text-sm text-slate-500 underline underline-offset-2 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Recusar
          </button>
        </div>
      </div>
    </div>
  );
}
