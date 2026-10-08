"use client";

import { useFormContext } from "react-hook-form";
import type { CheckoutFormValues } from "@/types/checkout";

// Consentimento para avisos pelo WhatsApp: andamento do pedido e lembretes do
// carrinho. Marcado por padrão; desmarcar vale para tudo (o site avisa o CRM
// com `optin_whatsapp: false` e nenhuma recuperação de carrinho sai).
export function CheckoutWhatsAppOptIn() {
  const { register } = useFormContext<CheckoutFormValues>();

  return (
    <label className="mt-3 flex items-start gap-3 text-xs leading-5 text-foreground">
      <input
        type="checkbox"
        {...register("whatsappOptIn")}
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-primary"
      />
      <span>
        Quero receber atualizações do pedido e lembretes do meu carrinho pelo
        WhatsApp
      </span>
    </label>
  );
}
