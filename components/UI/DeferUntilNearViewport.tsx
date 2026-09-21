"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface DeferUntilNearViewportProps {
  children: ReactNode;
  /**
   * Conteúdo exibido enquanto a seção ainda está longe da viewport. Deve ter
   * altura parecida com a do conteúdo final para não causar CLS.
   */
  fallback?: ReactNode;
  /**
   * Distância antes da viewport em que o conteúdo começa a carregar. O padrão
   * de 400px faz o carrossel ficar pronto antes de o usuário chegar nele.
   */
  rootMargin?: string;
}

/**
 * Só renderiza `children` quando a seção se aproxima da viewport.
 *
 * Componentes pesados carregados com `next/dynamic` têm o chunk baixado e
 * executado assim que são renderizados — ou seja, logo após a hidratação,
 * mesmo quando estão muito abaixo da dobra. Na Home isso colocava o Swiper
 * (~121 KB) no caminho crítico e alongava as tarefas longas que atrasam a
 * resposta ao primeiro toque (INP).
 *
 * Adiando a renderização até a seção se aproximar da tela, o chunk sai do
 * caminho crítico sem mudar o comportamento visual: com `rootMargin` o
 * carrossel já chega montado quando o usuário rola até ele.
 */
export function DeferUntilNearViewport({
  children,
  fallback = null,
  rootMargin = "400px",
}: DeferUntilNearViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    if (isNearViewport) return;

    const element = containerRef.current;
    // Sem suporte a IntersectionObserver, renderiza direto: é melhor pagar o
    // custo do que esconder conteúdo do usuário.
    if (!element || typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [isNearViewport, rootMargin]);

  return <div ref={containerRef}>{isNearViewport ? children : fallback}</div>;
}
