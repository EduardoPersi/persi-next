"use client";

import { useEffect } from "react";

// O navegador controla o texto exibido no diálogo nativo por questões de
// segurança — não é possível customizar a mensagem em navegadores modernos,
// só decidir quando o aviso deve aparecer.
export function useBeforeUnloadWarning(shouldWarn: boolean) {
  useEffect(() => {
    if (!shouldWarn) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [shouldWarn]);
}
