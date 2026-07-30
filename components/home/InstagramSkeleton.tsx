export function InstagramSkeleton() {
  return (
    <section className="mt-12" aria-label="Carregando publicações do Instagram">
      <div className="h-7 w-64 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-5 w-full max-w-md animate-pulse rounded bg-slate-100" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white"
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
