"use client";

import { useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  CHECKOUT_DRAFT_KEY,
  parseCheckoutDraft,
  serializeCheckoutDraft,
  type CheckoutDraftValues,
} from "@/lib/commerce/checkoutDraft";
import type { CheckoutFormValues } from "@/types/checkout";

const SAVE_DELAY_MS = 500;

// Lê o rascunho salvo (ou null). Seguro fora do navegador e com o
// armazenamento bloqueado (modo privado, política do navegador).
export function readStoredCheckoutDraft(): CheckoutDraftValues | null {
  if (typeof window === "undefined") return null;
  try {
    return parseCheckoutDraft(
      window.localStorage.getItem(CHECKOUT_DRAFT_KEY),
      Date.now(),
    );
  } catch {
    return null;
  }
}

// Autosave do formulário: grava 500 ms depois da última alteração e também
// ao esconder/fechar a página (`visibilitychange` e `pagehide`). Devolve se
// há alteração ainda não gravada — o aviso de saída só deve aparecer nesse
// caso. Se o armazenamento falhar, continua "não salvo" e o aviso permanece.
// Com `disabled` (pedido já criado) para de gravar e apaga o rascunho.
export function useCheckoutDraft(
  methods: UseFormReturn<CheckoutFormValues>,
  disabled: boolean,
) {
  const [hasUnsavedDraft, setHasUnsavedDraft] = useState(false);

  useEffect(() => {
    if (disabled) {
      try {
        window.localStorage.removeItem(CHECKOUT_DRAFT_KEY);
      } catch {
        // Sem acesso ao armazenamento: nada a apagar.
      }
      return;
    }

    let timer: number | undefined;

    const flush = () => {
      window.clearTimeout(timer);
      timer = undefined;
      try {
        const serialized = serializeCheckoutDraft(
          methods.getValues(),
          Date.now(),
        );
        if (serialized) {
          window.localStorage.setItem(CHECKOUT_DRAFT_KEY, serialized);
        } else {
          window.localStorage.removeItem(CHECKOUT_DRAFT_KEY);
        }
        setHasUnsavedDraft(false);
      } catch {
        // Armazenamento indisponível ou cheio: mantém "não salvo".
      }
    };

    const subscription = methods.watch(() => {
      setHasUnsavedDraft(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, SAVE_DELAY_MS);
    });
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      subscription.unsubscribe();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [methods, disabled]);

  return { hasUnsavedDraft };
}
