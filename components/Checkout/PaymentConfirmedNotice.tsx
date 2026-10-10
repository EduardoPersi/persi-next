"use client";

import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { LinkWhatsApp } from "@/components/UI/LinkWhatsApp";
import { STORE_INFO } from "@/lib/constants/storeInfo";

interface PaymentConfirmedNoticeProps {
  orderNumber: number;
}

// Confirmação SIMPLES, para quem recarregou a página no meio do pagamento e só
// provou ser o dono da tentativa pela chave (o Cart-Token do navegador ficou para
// trás). Só o número do pedido: sem nome, e-mail, telefone, endereço ou itens. Quem
// tem o cookie certo ou está logado vai para a página completa do pedido.
export function PaymentConfirmedNotice({ orderNumber }: PaymentConfirmedNoticeProps) {
  const whatsappMessage = `Olá! Fiz o pedido nº ${orderNumber} no site e queria falar sobre ele.`;
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm"
    >
      <CircleCheck className="mx-auto h-8 w-8 text-emerald-600" aria-hidden="true" />
      <p className="mt-3 text-base font-semibold text-foreground">
        Pagamento confirmado! Pedido nº {orderNumber}. Os detalhes foram enviados para o seu e-mail.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 py-2 text-base font-medium text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
        >
          Continuar comprando
        </Link>
        <LinkWhatsApp
          posicao="pagamento_confirmado"
          fallbackHref={`${STORE_INFO.whatsapp.href}?text=${encodeURIComponent(whatsappMessage)}`}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary px-4 py-2 text-base font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
        >
          Falar no WhatsApp
        </LinkWhatsApp>
      </div>
    </div>
  );
}
