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

  interface FetchedState {
    products: Product[];
    total: number;
  }

  const [fetched, setFetched] = useState<FetchedState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const lastFilterSignatureRef = useRef<string | null>(null);
  const lastPageRef = useRef(1);

  useEffect(() => {
    if (!hasFilters) {
      lastFilterSignatureRef.current = null;
      lastPageRef.current = 1;
      return;
    }

    const currentPage = Math.max(
      Number.parseInt(searchParams.get("pagina") ?? "1", 10) || 1,
      1,
    );
    const filterSignature = new URLSearchParams(searchParams);
    filterSignature.delete("pagina");
    const signatureKey = filterSignature.toString();

    const isSameFilters = lastFilterSignatureRef.current === signatureKey;
    const isLoadMore = isSameFilters && currentPage > lastPageRef.current;

    let cancelled = false;

    async function run() {
      if (isLoadMore) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        if (isLoadMore) {
          const result = await fetchBrandProducts(
            brandSlug,
            searchParams,
            currentPage,
          );
          if (cancelled) return;
          setFetched((previous) => ({
            products: [...(previous?.products ?? []), ...result.products],
            total: result.total,
          }));
        } else {
          const pages = await Promise.all(
            Array.from({ length: currentPage }, (_, index) =>
              fetchBrandProducts(brandSlug, searchParams, index + 1),
            ),
          );
          if (cancelled) return;
          const last = pages[pages.length - 1];
          setFetched({
            products: pages.flatMap((page) => page.products),
            total: last.total,
          });
        }
        lastFilterSignatureRef.current = signatureKey;
        lastPageRef.current = currentPage;
      } catch {
        // Mantém a última lista carregada com sucesso em caso de falha.
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamsKey, brandSlug]);

  const products = hasFilters ? (fetched?.products ?? []) : initialProducts;
  const total = hasFilters ? (fetched?.total ?? 0) : initialTotal;

  const currentOrder = searchParams.get("ordem") ?? "recentes";
  const normalizedParams = normalizeSearchParams(searchParams);
  const preservedSortParams = { ...normalizedParams };
  delete preservedSortParams.ordem;
  delete preservedSortParams.pagina;
  const currentPage = Math.max(
    Number.parseInt(searchParams.get("pagina") ?? "1", 10) || 1,
    1,
  );
  const loadMoreParams = {
    ...normalizedParams,
    pagina: String(currentPage + 1),
  };
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
                  pathname={pathname}
                  searchParams={loadMoreParams}
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
