"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useTransition,
  type ReactNode,
} from "react";

export interface RouteTransitionValue {
  isPending: boolean;
  navigate(href: string): void;
}

export const RouteTransitionContext =
  createContext<RouteTransitionValue | null>(null);

const SKIP_ATTRIBUTE = "data-route-transition-skip";

export function RouteTransitionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const navigationInProgress = useRef(false);

  useEffect(() => {
    if (!isPending) navigationInProgress.current = false;
  }, [isPending]);

  const navigate = useCallback(
    (href: string) => {
      startTransition(() => {
        router.push(href);
      });
    },
    [router],
  );

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a");
      if (!anchor) return;
      if (anchor.closest(`[${SKIP_ATTRIBUTE}]`)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      // Links que se desabilitam condicionalmente (ex.: "Finalizar compra"
      // com carrinho vazio) sinalizam isso via aria-disabled — checar aqui
      // em vez de depender do preventDefault do próprio onClick do link,
      // já que agora capturamos o clique antes dele (ver comentário abaixo).
      if (anchor.getAttribute("aria-disabled") === "true") return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      const currentTarget = `${window.location.pathname}${window.location.search}`;
      const nextTarget = `${url.pathname}${url.search}`;
      if (nextTarget === currentTarget) return;

      event.preventDefault();
      if (navigationInProgress.current || isPending) return;
      navigationInProgress.current = true;
      navigate(`${url.pathname}${url.search}${url.hash}`);
    }

    // Fase de captura (não a de bubble, padrão do addEventListener): o
    // próprio <Link> do Next.js já chama preventDefault() no seu próprio
    // onClick para fazer a navegação client-side dele. Um listener em
    // bubble no document roda DEPOIS desse onClick, então "event.
    // defaultPrevented" já vinha true e este handler nunca chegava a
    // interceptar nada — o Next navegava por conta própria, sem overlay
    // nenhum. Capturando antes, somos nós quem chama preventDefault()
    // primeiro; o Link, ao rodar depois, vê defaultPrevented=true e cede
    // a navegação para o nosso router.push()/startTransition().
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [isPending, navigate]);

  const value = useMemo(
    () => ({ isPending, navigate }),
    [isPending, navigate],
  );

  return (
    <RouteTransitionContext.Provider value={value}>
      {children}
    </RouteTransitionContext.Provider>
  );
}
