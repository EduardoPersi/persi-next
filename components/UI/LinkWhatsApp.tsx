"use client";

import {
  useCallback,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from "react";
import { usePathname } from "next/navigation";
import { registrarCliqueWhatsapp } from "@/lib/analytics/eventos";
import { CONFIG_DE_LINKS } from "@/lib/tracking/config";
import { EVENTO_RASTREIO, lerHrefRastreado } from "@/lib/tracking/navegador";
import { hrefInicial, linkRastreadoBase } from "@/lib/tracking/whatsappLink";

interface LinkWhatsAppProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  /**
   * Onde o botão está (ex.: "botao_flutuante", "rodape"). Vai no evento
   * `clique_whatsapp` para o GA4 mostrar qual botão converte.
   */
  posicao: string;
  /**
   * O link original (`wa.me`). Usado quando o rastreio não está configurado —
   * o botão de WhatsApp nunca pode deixar de funcionar.
   */
  fallbackHref: string;
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENTO_RASTREIO, onChange);
  return () => window.removeEventListener(EVENTO_RASTREIO, onChange);
}

/**
 * ÚNICO componente de link/botão de WhatsApp do site.
 *
 * - No servidor (e sem JavaScript) o `href` já é o link rastreado sem
 *   parâmetros (`<base>/w/<codigo>`); o painel redireciona para o WhatsApp.
 * - Depois da hidratação, o `href` ganha UTM, gclid, GA client_id, página etc.
 *   — assim "abrir em nova aba" e "copiar endereço" também levam a origem.
 * - No clique, o `href` é recalculado na hora (consentimento ou cookies podem
 *   ter mudado) e o evento `clique_whatsapp` vai ao dataLayer.
 *
 * Sem `NEXT_PUBLIC_WHATSAPP_LINK_CODIGO`, é um link `wa.me` comum.
 */
export function LinkWhatsApp({
  posicao,
  fallbackHref,
  onClick,
  target = "_blank",
  rel = "noopener noreferrer",
  children,
  ...resto
}: LinkWhatsAppProps) {
  // Trocar de rota muda o `pg` do link; usePathname faz este componente
  // reavaliar o snapshot abaixo.
  const pathname = usePathname();
  const href = useSyncExternalStore(
    subscribe,
    () => lerHrefRastreado(fallbackHref),
    () => hrefInicial(CONFIG_DE_LINKS, fallbackHref),
  );

  const aoClicar = useCallback(
    (evento: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(evento);
      const recente = lerHrefRastreado(fallbackHref);
      // Atualiza antes de o navegador seguir o link.
      evento.currentTarget.href = recente;
      registrarCliqueWhatsapp({
        posicao,
        linkRastreado: linkRastreadoBase(CONFIG_DE_LINKS) !== null,
        codigo: CONFIG_DE_LINKS.codigo || undefined,
        pagina: pathname,
      });
    },
    [fallbackHref, onClick, pathname, posicao],
  );

  return (
    <a {...resto} href={href} target={target} rel={rel} onClick={aoClicar}>
      {children}
    </a>
  );
}
