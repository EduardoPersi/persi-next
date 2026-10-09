"use client";

import { LoaderCircle } from "lucide-react";
import { LinkWhatsApp } from "@/components/UI/LinkWhatsApp";
import { STORE_INFO } from "@/lib/constants/storeInfo";
import {
  PAYMENT_PROCESSING_MESSAGE,
  PAYMENT_TIMEOUT_MESSAGE,
} from "@/lib/commerce/paymentPolling";

interface PaymentProcessingNoticeProps {
  // "confirming": consultando o banco; "timeout": passaram os 2 minutos.
  state: "confirming" | "timeout";
}

const WHATSAPP_MESSAGE = "Olá! Fiz um pagamento no site e ainda não recebi a confirmação.";

// Tela de "pagamento em processamento". Não oferece outro pagamento: o
// resultado da cobrança ainda é incerto, e pagar de novo poderia cobrar em
// dobro. Ver lib/commerce/paymentPolling.ts.
export function PaymentProcessingNotice({ state }: PaymentProcessingNoticeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm"
    >
      {state === "confirming" ? (
        <>
          <LoaderCircle
            className="mx-auto h-8 w-8 animate-spin text-primary"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-semibold text-foreground">
            {PAYMENT_PROCESSING_MESSAGE}
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-foreground">{PAYMENT_TIMEOUT_MESSAGE}</p>
          <LinkWhatsApp
            posicao="pagamento_em_processamento"
            fallbackHref={`${STORE_INFO.whatsapp.href}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-primary px-4 py-2 text-base font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 sm:w-auto"
          >
            Falar com a gente no WhatsApp
          </LinkWhatsApp>
        </>
      )}
    </div>
  );
}
