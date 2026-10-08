"use client";

import { useEffect } from "react";
import type { RecuperacaoParaOCheckout } from "@/lib/painel/recuperarCookie";
import { storeCheckoutPrefill } from "@/lib/commerce/checkoutPrefillStorage";

interface CheckoutRecoveryNoticeProps {
  recuperacao: RecuperacaoParaOCheckout;
}

// Chegada pelo link de recuperação (`/r/<token>`): entrega ao checkout o
// pré-preenchimento (nome, WhatsApp, CEP) pelo mesmo caminho do link da Fase A
// (a sessão da aba, aplicada uma única vez só em campos vazios), apaga o cookie
// de 10 minutos e avisa o que foi recuperado.
export function CheckoutRecoveryNotice({ recuperacao }: CheckoutRecoveryNoticeProps) {
  const { prefill, aviso } = recuperacao;

  useEffect(() => {
    // Antes de o formulário montar (ele espera o carrinho carregar).
    if (prefill) storeCheckoutPrefill(prefill);
    void fetch("/api/checkout/recuperacao", {
      method: "DELETE",
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  }, [prefill]);

  const mensagens: Array<{ texto: string; tom: "sucesso" | "alerta" }> = [];
  if (aviso.restaurados > 0) {
    mensagens.push({ texto: "Recuperamos os itens do seu carrinho.", tom: "sucesso" });
  }
  if (aviso.ausentes > 0) {
    mensagens.push({ texto: "Alguns itens não estão mais disponíveis.", tom: "alerta" });
  }
  if (aviso.ajustados > 0) {
    mensagens.push({
      texto: "Ajustamos a quantidade de alguns itens ao estoque disponível.",
      tom: "alerta",
    });
  }
  if (mensagens.length === 0) return null;

  return (
    <div className="mb-4 space-y-2" role="status" aria-live="polite">
      {mensagens.map(({ texto, tom }) => (
        <p
          key={texto}
          className={
            tom === "sucesso"
              ? "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
              : "rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
          }
        >
          {texto}
        </p>
      ))}
    </div>
  );
}
