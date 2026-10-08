"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const MENSAGENS: Record<string, string> = {
  "link-expirado": "Esse link expirou, mas seus produtos continuam na loja.",
  "itens-indisponiveis": "Esses itens não estão mais disponíveis.",
};

// Aviso quando o link de recuperação (`/r/<token>`) não pôde ser usado. Nunca
// diz o motivo técnico. Lê `?aviso=` e o tira da barra de endereço, para o
// aviso não voltar ao recarregar a página.
export function CartRecoveryNotice() {
  const searchParams = useSearchParams();
  const codigo = searchParams.get("aviso");
  const [mensagem, setMensagem] = useState<string | null>(null);

  useEffect(() => {
    if (!codigo) return;
    const texto = MENSAGENS[codigo];
    if (!texto) return;
    queueMicrotask(() => setMensagem(texto));
    const url = new URL(window.location.href);
    url.searchParams.delete("aviso");
    window.history.replaceState(window.history.state, "", url);
  }, [codigo]);

  if (!mensagem) return null;
  return (
    <p
      className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
      role="status"
    >
      {mensagem}
    </p>
  );
}
