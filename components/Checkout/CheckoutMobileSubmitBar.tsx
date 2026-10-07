"use client";

import { useEffect, useState, type RefObject } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/UI/Button";

interface CheckoutMobileSubmitBarProps {
  // Só aparece na etapa de pagamento.
  active: boolean;
  // Botão real "Comprar": a barra some enquanto ele estiver na tela e o clique
  // na barra dispara o clique dele (mesma validação, mesmo envio).
  submitButtonRef: RefObject<HTMLButtonElement | null>;
  total?: number;
  currencyCode?: string;
  isSubmitting: boolean;
  disabled: boolean;
}

// Barra fixa no rodapé, só no mobile, com o total e o "Finalizar compra"
// quando o botão real saiu da tela. O botão do WhatsApp já fica oculto em
// /checkout, então não há sobreposição.
export function CheckoutMobileSubmitBar({
  active,
  submitButtonRef,
  total,
  currencyCode = "BRL",
  isSubmitting,
  disabled,
}: CheckoutMobileSubmitBarProps) {
  // Começa como "visível" para a barra não piscar antes do observer medir.
  const [realButtonInView, setRealButtonInView] = useState(true);

  useEffect(() => {
    const realButton = submitButtonRef.current;
    if (!active || !realButton) return;

    const observer = new IntersectionObserver(([entry]) => {
      setRealButtonInView(entry.isIntersecting);
    });
    observer.observe(realButton);
    return () => observer.disconnect();
  }, [active, submitButtonRef]);

  if (!active || realButtonInView) return null;

  const formattedTotal =
    typeof total === "number"
      ? new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: currencyCode,
        }).format(total)
      : null;

  return (
    <div
      role="region"
      aria-label="Finalizar compra"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.08)] lg:hidden"
    >
      <div className="mx-auto flex max-w-xl items-center gap-3">
        {formattedTotal ? (
          <div className="min-w-0">
            <p className="text-xs text-muted">Total</p>
            <p className="text-base font-bold text-primary">{formattedTotal}</p>
          </div>
        ) : null}
        <Button
          type="button"
          size="lg"
          disabled={disabled || isSubmitting}
          onClick={() => submitButtonRef.current?.click()}
          className="ml-auto flex-1"
        >
          {isSubmitting ? (
            "Processando..."
          ) : (
            <>
              <Lock className="h-4 w-4" aria-hidden="true" />
              Finalizar compra
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
