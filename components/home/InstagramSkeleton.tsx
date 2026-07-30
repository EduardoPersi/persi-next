export function InstagramSkeleton() {
  return (
    <section className="mt-12" aria-label="Carregando publicações do Instagram">
      <div className="h-7 w-64 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-5 w-full max-w-md animate-pulse rounded bg-slate-100" />
      <div className="mt-6 flex gap-3 overflow-hidden sm:gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="w-[83%] shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white min-[480px]:w-[calc(50%-0.375rem)] md:w-[calc(33.333%-0.667rem)]"
            aria-hidden="true"
          >
            <div className="aspect-square animate-pulse bg-slate-200" />
            <div className="space-y-2 p-3 sm:p-4">
              <div className="h-4 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
