"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import { useRouteTransition } from "@/hooks/useRouteTransition";

export function RouteTransitionOverlay({
  children,
}: {
  children: ReactNode;
}) {
  const { isPending } = useRouteTransition();

  return (
    <div className="relative flex-1">
      <div
        className={clsx(
          "transition-opacity duration-300",
          isPending ? "pointer-events-none opacity-60" : "opacity-100",
        )}
      >
        {children}
      </div>

      <div
        aria-hidden={!isPending}
        className={clsx(
          "fixed inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-none transition-opacity duration-300",
          isPending ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        <span
          role="status"
          aria-live="polite"
          className="text-lg font-bold uppercase tracking-wide text-secondary"
        >
          Carregando...
        </span>
      </div>
    </div>
  );
}
