"use client";

import { useContext } from "react";
import { useRouter } from "next/navigation";
import { RouteTransitionContext } from "@/context/RouteTransition";

export function useRouteTransition() {
  const context = useContext(RouteTransitionContext);
  const router = useRouter();

  if (context) return context;

  return {
    isPending: false,
    navigate: (href: string) => router.push(href),
  };
}
