"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useLayoutEffect, useTransition } from "react";

let pendingScrollPosition: number | null = null;

interface LoadMoreButtonProps {
  pathname: string;
  searchParams: Record<string, string>;
}

export function LoadMoreButton({
  pathname,
  searchParams,
}: LoadMoreButtonProps) {
  const router = useRouter();
  const currentSearchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  useLayoutEffect(() => {
    const scrollPosition = pendingScrollPosition;
    if (scrollPosition === null) return;

    pendingScrollPosition = null;
    window.scrollTo(window.scrollX, scrollPosition);
  }, [currentSearchParams]);

  function handleLoadMore() {
    const query = new URLSearchParams(searchParams);
    pendingScrollPosition = window.scrollY;

    startTransition(() => {
      router.push(`${pathname}?${query.toString()}`, {
        scroll: false,
      });
    });
  }

  return (
    <button
      type="button"
      onClick={handleLoadMore}
      disabled={isPending}
      className="inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-white disabled:text-foreground disabled:ring-1 disabled:ring-inset disabled:ring-slate-300"
      aria-live="polite"
    >
      {isPending ? (
        <>
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary"
            aria-hidden="true"
          />
          CARREGANDO...
        </>
      ) : (
        "VER MAIS"
      )}
    </button>
  );
}
