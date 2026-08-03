"use client";

import { useEffect, useRef } from "react";

const ATTENTION_TITLE = "Quase lá! 👋";

// SVG inline (sem depender de nenhum arquivo de imagem) usando o laranja já
// padronizado da marca (#ff6a00), só para o favicon "chamando atenção"
// enquanto a aba fica em segundo plano.
const ATTENTION_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E" +
  "%3Ccircle cx='16' cy='16' r='15' fill='%23ff6a00'/%3E" +
  "%3Ctext x='16' y='22' font-size='18' text-anchor='middle' fill='white' " +
  "font-family='system-ui,sans-serif' font-weight='700'%3E!%3C/text%3E%3C/svg%3E";

function swapFavicon(href: string): () => void {
  const links = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
  );
  const originals = links.map((link) => ({ link, href: link.href }));
  links.forEach((link) => {
    link.href = href;
  });
  return () => {
    originals.forEach((original) => {
      original.link.href = original.href;
    });
  };
}

// Troca o título (e o favicon) da aba para chamar atenção quando o usuário
// sai da aba no meio do checkout, restaurando exatamente o título original
// (o que já estava definido na página, não um texto fixo) quando ele volta.
export function useTabAttentionTitle(active: boolean) {
  const originalTitleRef = useRef<string | null>(null);
  const restoreFaviconRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) return;

    function handleVisibilityChange() {
      if (document.hidden) {
        originalTitleRef.current = document.title;
        document.title = ATTENTION_TITLE;
        restoreFaviconRef.current = swapFavicon(ATTENTION_FAVICON);
      } else {
        if (originalTitleRef.current !== null) {
          document.title = originalTitleRef.current;
          originalTitleRef.current = null;
        }
        restoreFaviconRef.current?.();
        restoreFaviconRef.current = null;
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (originalTitleRef.current !== null) {
        document.title = originalTitleRef.current;
        originalTitleRef.current = null;
      }
      restoreFaviconRef.current?.();
      restoreFaviconRef.current = null;
    };
  }, [active]);
}
