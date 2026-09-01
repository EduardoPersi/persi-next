export function HomeCategoryCarouselSkeleton() {
  return (
    <section aria-label="Carregando categorias" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
      <div className="mt-5 flex gap-2 overflow-hidden pb-7 sm:gap-3 lg:gap-4">
        {Array.from({ length: 10 }, (_, index) => (
          <div
            key={index}
            className="flex w-14 shrink-0 flex-col items-center gap-2 sm:w-16 lg:w-20"
            aria-hidden="true"
          >
            <div className="aspect-square w-full animate-pulse rounded-full bg-slate-200" />
            <div className="h-3 w-10 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </section>
  );
}
