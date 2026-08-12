"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
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
      if (isPending) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a");
      if (!anchor) return;
      if (anchor.closest(`[${SKIP_ATTRIBUTE}]`)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

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
      navigate(`${url.pathname}${url.search}${url.hash}`);
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
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
