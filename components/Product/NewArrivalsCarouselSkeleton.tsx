export function NewArrivalsCarouselSkeleton() {
  return (
    <section aria-label="Carregando novidades" aria-busy="true">
      <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
      <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded bg-slate-100" />
      <div className="mt-5 flex gap-3 overflow-hidden pb-9 sm:gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="w-[calc(50%-0.375rem)] shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white sm:w-[calc(33.333%-0.75rem)] lg:w-[calc(25%-0.9375rem)]"
            aria-hidden="true"
          >
            <div className="aspect-square animate-pulse bg-slate-100" />
            <div className="space-y-3 p-4">
              <div className="h-3 w-1/3 animate-pulse rounded-md bg-slate-100" />
              <div className="h-10 animate-pulse rounded-md bg-slate-100" />
              <div className="h-5 w-2/3 animate-pulse rounded-md bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
