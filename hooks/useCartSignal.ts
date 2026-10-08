"use client";

import { useEffect, useRef } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import {
  emailDoCarrinho,
  etapaDoContrato,
  temContatoValido,
  whatsappDoCarrinho,
} from "@/lib/painel/carrinhoContato";
import type { Cart } from "@/types/cart";
import type { CheckoutFormValues } from "@/types/checkout";

const DEBOUNCE_MS = 800;

interface UseCartSignalInput {
  methods: UseFormReturn<CheckoutFormValues>;
  step: "profile" | "address" | "payment";
  cart: Cart | null;
  // Falso com a flag do servidor desligada ou com o pedido já criado.
  enabled: boolean;
}

// Avisa o servidor (que repassa ao painel de atendimento) do estado do
// carrinho: quando há e-mail válido ou WhatsApp com 10/11 dígitos, 800 ms
// depois da última mudança, e de novo quando mudam a etapa, os itens ou o
// opt-in. O navegador manda só contato, etapa e opt-in; itens, preços e total
// o servidor lê do carrinho real. Falha aqui nunca aparece para o cliente.
export function useCartSignal({ methods, step, cart, enabled }: UseCartSignalInput) {
  const [firstName, lastName, email, phone, optIn] = useWatch({
    control: methods.control,
    name: [
      "contact.firstName",
      "contact.lastName",
      "contact.email",
      "contact.phone",
      "whatsappOptIn",
    ],
  });
  const lastSent = useRef("");

  const itemsSignature = (cart?.items ?? [])
    .map((item) => `${item.key}:${item.quantity}`)
    .join("|");
  const couponsSignature = (cart?.coupons ?? []).map((coupon) => coupon.code).join("|");

  useEffect(() => {
    if (!enabled) return;
    if (!temContatoValido({ email, whatsapp: phone })) return;

    const body = {
      ...(`${firstName ?? ""} ${lastName ?? ""}`.trim()
        ? { nome: `${firstName ?? ""} ${lastName ?? ""}`.trim() }
        : {}),
      ...(emailDoCarrinho(email) ? { email: emailDoCarrinho(email) } : {}),
      ...(whatsappDoCarrinho(phone) ? { whatsapp: whatsappDoCarrinho(phone) } : {}),
      etapa: etapaDoContrato(step),
      optin_whatsapp: optIn !== false,
    };
    const signature = JSON.stringify([body, itemsSignature, couponsSignature]);
    if (signature === lastSent.current) return;

    const timer = window.setTimeout(() => {
      lastSent.current = signature;
      void fetch("/api/checkout/cart-signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    enabled,
    firstName,
    lastName,
    email,
    phone,
    optIn,
    step,
    itemsSignature,
    couponsSignature,
  ]);
}
