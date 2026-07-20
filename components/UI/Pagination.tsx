import Link from "next/link";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  pathname: string;
  searchParams: Record<string, string>;
}

function getVisiblePages(
  currentPage: number,
  totalPages: number,
): Array<number | "ellipsis-start" | "ellipsis-end"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages: Array<number | "ellipsis-start" | "ellipsis-end"> = [1];

  if (currentPage > 4) {
    pages.push("ellipsis-start");
  }

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  if (currentPage < totalPages - 3) {
    pages.push("ellipsis-end");
  }

  pages.push(totalPages);

  return pages;
}

export function Pagination({
  currentPage,
  totalPages,
  pathname,
  searchParams,
}: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  function getPageHref(page: number): string {
    const params = new URLSearchParams(searchParams);

    if (page <= 1) {
      params.delete("pagina");
    } else {
      params.set("pagina", String(page));
    }

    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return (
    <nav
      className="mt-10 flex flex-wrap items-center justify-center gap-2"
      aria-label="Paginação de produtos"
    >
      {currentPage > 1 ? (
        <Link
          href={getPageHref(currentPage - 1)}
          className="flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-[#0c2d72] hover:text-[#0c2d72]"
          rel="prev"
        >
          Anterior
        </Link>
      ) : null}

      {getVisiblePages(currentPage, totalPages).map((page) =>
        typeof page === "number" ? (
          <Link
            key={page}
            href={getPageHref(page)}
            aria-current={page === currentPage ? "page" : undefined}
            className={`flex h-10 min-w-10 items-center justify-center rounded-xl border px-3 text-sm font-semibold ${
              page === currentPage
                ? "border-[#0c2d72] bg-[#0c2d72] text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-[#0c2d72] hover:text-[#0c2d72]"
            }`}
          >
            {page}
          </Link>
        ) : (
          <span key={page} className="px-1 text-slate-500">
            …
          </span>
        ),
      )}

      {currentPage < totalPages ? (
        <Link
          href={getPageHref(currentPage + 1)}
          className="flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-[#0c2d72] hover:text-[#0c2d72]"
          rel="next"
        >
          Próxima
        </Link>
      ) : null}
    </nav>
  );
}
