"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

interface LoadMoreButtonProps {
  pathname: string;
  searchParams: Record<string, string>;
}

export function LoadMoreButton({
  pathname,
  searchParams,
}: LoadMoreButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleLoadMore() {
    const query = new URLSearchParams(searchParams);

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
      className="inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-[6px] bg-[#0c2d72] px-6 text-sm font-medium text-white transition-colors hover:bg-[#071f5c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-white disabled:text-slate-700 disabled:ring-1 disabled:ring-inset disabled:ring-slate-300"
      aria-live="polite"
    >
      {isPending ? (
        <>
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#0c2d72]"
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
