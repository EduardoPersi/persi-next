"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CategorySort } from "@/components/Category/CategorySort";
import { LoadMoreButton } from "@/components/Category/LoadMoreButton";
import { ProductGrid } from "@/components/Category/CategoryProductsClient";
import {
  hasActiveFilterParams,
  normalizeSearchParams,
} from "@/lib/commerce/categoryFilters";
import type { Product } from "@/types/product";

interface BrandProductsResponse {
  products: Product[];
  total: number;
  page: number;
}

interface BrandProductsClientProps {
  brandSlug: string;
  pathname: string;
  initialProducts: Product[];
  initialTotal: number;
}

async function fetchBrandProducts(
  brandSlug: string,
  searchParams: URLSearchParams,
  page: number,
): Promise<BrandProductsResponse> {
  const query = new URLSearchParams(searchParams);
  query.set("marca", brandSlug);
  query.set("pagina", String(page));

  const response = await fetch(`/api/catalog/brand-products?${query.toString()}`);
  if (!response.ok) {
    throw new Error("Não foi possível carregar os produtos da marca.");
  }
  return response.json();
}

export function BrandProductsFallback({
  initialProducts,
  initialTotal,
}: Pick<BrandProductsClientProps, "initialProducts" | "initialTotal">) {
  return (
    <div className="mt-6">
      <p className="sr-only" aria-live="polite">
        {initialTotal}{" "}
        {initialTotal === 1 ? "produto encontrado" : "produtos encontrados"}
      </p>
      <ProductGrid products={initialProducts} />
    </div>
  );
}

export function BrandProductsInteractive({
  brandSlug,
  pathname,
  initialProducts,
  initialTotal,
}: BrandProductsClientProps) {
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const hasFilters = hasActiveFilterParams(searchParams);

  interface ListState {
    products: Product[];
    total: number;
    page: number;
  }

  const [state, setState] = useState<ListState>({
    products: initialProducts,
    total: initialTotal,
    page: 1,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Invalidada a cada troca de filtro, para descartar uma resposta de
  // "carregar mais" que ainda esteja em voo quando o filtro muda.
  const requestIdRef = useRef(0);

  // Ajusta o estado durante a renderização (em vez de em um efeito) quando
  // os filtros são removidos, voltando à listagem inicial vinda do
  // servidor sem esperar um novo ciclo de efeito.
  const [wasFiltered, setWasFiltered] = useState(hasFilters);
  if (hasFilters !== wasFiltered) {
    setWasFiltered(hasFilters);
    if (!hasFilters) {
      setState({ products: initialProducts, total: initialTotal, page: 1 });
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!hasFilters) {
      // Invalida qualquer fetch filtrado ainda em voo.
      requestIdRef.current += 1;
      return;
    }

    const requestId = (requestIdRef.current += 1);
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      try {
        const result = await fetchBrandProducts(brandSlug, searchParams, 1);
        if (cancelled || requestIdRef.current !== requestId) return;
        setState({ products: result.products, total: result.total, page: 1 });
      } catch {
        // Mantém a última lista carregada com sucesso em caso de falha.
      } finally {
        if (!cancelled && requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamsKey, brandSlug, hasFilters]);

  async function handleLoadMore() {
    if (isLoadingMore) return;

    const requestId = (requestIdRef.current += 1);
    const nextPage = state.page + 1;
    setIsLoadingMore(true);

    try {
      const result = await fetchBrandProducts(brandSlug, searchParams, nextPage);
      if (requestIdRef.current !== requestId) return;
      setState((previous) => ({
        products: [...previous.products, ...result.products],
        total: result.total,
        page: nextPage,
      }));
    } catch {
      // Mantém a última lista carregada com sucesso em caso de falha.
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoadingMore(false);
      }
    }
  }

  const { products, total } = state;

  const currentOrder = searchParams.get("ordem") ?? "recentes";
  const normalizedParams = normalizeSearchParams(searchParams);
  const preservedSortParams = { ...normalizedParams };
  delete preservedSortParams.ordem;
  delete preservedSortParams.pagina;
  const hasMoreProducts = products.length < total;

  return (
    <div className="mt-6">
      <div className="flex flex-col gap-4 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="sr-only" aria-live="polite">
          {total} {total === 1 ? "produto encontrado" : "produtos encontrados"}
        </p>
        <div className="flex justify-end">
          <CategorySort
            key={currentOrder}
            pathname={pathname}
            currentOrder={currentOrder}
            preservedParams={preservedSortParams}
          />
        </div>
      </div>

      <div className="mt-6" aria-busy={isLoading}>
        {isLoading ? (
          <div
            className="grid grid-cols-2 gap-[10px] md:grid-cols-3 lg:grid-cols-4"
            aria-hidden="true"
          >
            {Array.from({ length: 8 }).map((_, index) => (
              <div
                key={index}
                className="aspect-[3/4] animate-pulse rounded-xl bg-slate-100"
              />
            ))}
          </div>
        ) : products.length > 0 ? (
          <>
            <ProductGrid products={products} />
            {hasMoreProducts ? (
              <div className="mt-8 flex justify-center">
                <LoadMoreButton
                  onClick={handleLoadMore}
                  isLoading={isLoadingMore}
                />
              </div>
            ) : null}
            {isLoadingMore ? (
              <p className="sr-only" aria-live="polite">
                Carregando mais produtos…
              </p>
            ) : null}
          </>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
            <h2 className="text-lg font-bold text-primary">
              Nenhum produto encontrado
            </h2>
          </div>
        )}
      </div>
    </div>
  );
}
