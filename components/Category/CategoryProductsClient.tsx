"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CategoryFilters,
  type CategoryFilterValues,
} from "@/components/Category/CategoryFilters";
import { CategorySort } from "@/components/Category/CategorySort";
import { LoadMoreButton } from "@/components/Category/LoadMoreButton";
import { ProductCard } from "@/components/Product/ProductCard";
import {
  hasActiveFilterParams,
  normalizeSearchParams,
} from "@/lib/commerce/categoryFilters";
import { getProductHref } from "@/lib/routing/storefrontUrls";
import type { CatalogFilterData } from "@/types/catalog-filters";
import type { Product } from "@/types/product";

interface CategoryProductsResponse {
  products: Product[];
  total: number;
  totalPages: number;
  page: number;
  brand: { name: string; slug: string } | null;
}

interface CategoryProductsClientProps {
  categorySlug: string;
  categoryName: string;
  pathname: string;
  filterData: CatalogFilterData;
  initialProducts: Product[];
  initialTotal: number;
}

async function fetchCategoryProducts(
  categorySlug: string,
  searchParams: URLSearchParams,
  page: number,
): Promise<CategoryProductsResponse> {
  const query = new URLSearchParams(searchParams);
  query.set("categoria", categorySlug);
  query.set("pagina", String(page));

  const response = await fetch(
    `/api/catalog/category-products?${query.toString()}`,
  );
  if (!response.ok) {
    throw new Error("Não foi possível carregar os produtos filtrados.");
  }
  return response.json();
}

function ProductGrid({ products }: { products: Product[] }) {
  return (
    <div className="grid grid-cols-2 gap-[10px] md:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          name={product.name}
          image={product.image?.src ?? ""}
          images={product.images}
          href={getProductHref(product.slug)}
          price={product.price}
          regularPrice={product.onSale ? product.regularPrice : undefined}
          currencyCode={product.currencyCode}
          commercialText={product.commercialText}
          brand={product.brands[0]?.name}
          badge={product.onSale ? "Oferta" : undefined}
          available={product.available}
          showAddToCart
          productId={product.id}
          productSlug={product.slug}
          freeShipping={product.freeShipping}
          productType={product.type}
          isPurchasable={product.isPurchasable}
          hasOptions={product.hasOptions}
        />
      ))}
    </div>
  );
}

export function CategoryProductsFallback({
  categoryName,
  initialProducts,
  initialTotal,
}: Pick<
  CategoryProductsClientProps,
  "categoryName" | "initialProducts" | "initialTotal"
>) {
  return (
    <div className="mt-4 sm:mt-6 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-4">
      <div className="hidden lg:block" />
      <div className="min-w-0">
        <div className="bg-white p-4">
          <h1 className="text-2xl font-bold text-primary">{categoryName}</h1>
          <p className="sr-only" aria-live="polite">
            {initialTotal}{" "}
            {initialTotal === 1 ? "produto encontrado" : "produtos encontrados"}
          </p>
        </div>
        <div className="mt-6">
          <ProductGrid products={initialProducts} />
        </div>
      </div>
    </div>
  );
}

export function CategoryProductsInteractive({
  categorySlug,
  categoryName,
  pathname,
  filterData,
  initialProducts,
  initialTotal,
}: CategoryProductsClientProps) {
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const hasFilters = hasActiveFilterParams(searchParams);

  interface FetchedState {
    products: Product[];
    total: number;
    brandName: string | null;
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
          const result = await fetchCategoryProducts(
            categorySlug,
            searchParams,
            currentPage,
          );
          if (cancelled) return;
          setFetched((previous) => ({
            products: [...(previous?.products ?? []), ...result.products],
            total: result.total,
            brandName: result.brand?.name ?? null,
          }));
        } else {
          const pages = await Promise.all(
            Array.from({ length: currentPage }, (_, index) =>
              fetchCategoryProducts(categorySlug, searchParams, index + 1),
            ),
          );
          if (cancelled) return;
          const last = pages[pages.length - 1];
          setFetched({
            products: pages.flatMap((page) => page.products),
            total: last.total,
            brandName: last.brand?.name ?? null,
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
  }, [searchParamsKey, categorySlug]);

  const products = hasFilters ? (fetched?.products ?? []) : initialProducts;
  const total = hasFilters ? (fetched?.total ?? 0) : initialTotal;
  const brandName = hasFilters ? (fetched?.brandName ?? null) : null;

  const currentOrder = searchParams.get("ordem") ?? "recentes";
  const filterValues: CategoryFilterValues = {
    minPrice: searchParams.get("preco_min") ?? undefined,
    maxPrice: searchParams.get("preco_max") ?? undefined,
    availability: searchParams.get("estoque") ?? undefined,
    promotion: searchParams.get("promocao") ?? undefined,
    brand: searchParams.get("marca") ?? undefined,
    order: currentOrder,
    attributes: Object.fromEntries(
      Array.from(searchParams.entries()).filter(([key]) =>
        key.startsWith("atributo_"),
      ),
    ),
  };
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
    <div className="mt-4 sm:mt-6 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-4">
      <div className="hidden lg:block">
        <CategoryFilters
          key={`desktop-${JSON.stringify(filterValues)}`}
          mode="desktop"
          pathname={pathname}
          values={filterValues}
          filterData={filterData}
        />
      </div>

      <div className="min-w-0">
        <div className="flex flex-col gap-4 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-primary">
              {categoryName}
            </h1>
            <p className="sr-only" aria-live="polite">
              {total} {total === 1 ? "produto encontrado" : "produtos encontrados"}
            </p>
            {brandName ? (
              <p className="mt-1 text-sm text-muted">
                Marca:{" "}
                <span className="font-semibold text-foreground">
                  {brandName}
                </span>
              </p>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <CategoryFilters
              key={`mobile-${JSON.stringify(filterValues)}`}
              mode="mobile"
              pathname={pathname}
              values={filterValues}
              filterData={filterData}
            />
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
              <p className="mt-2 text-sm text-muted">
                Tente remover alguns filtros ou escolher outra subcategoria.
              </p>
              <Link
                href={pathname}
                className="mt-5 inline-flex h-11 items-center justify-center rounded-xl bg-secondary px-5 text-sm font-semibold text-white"
              >
                Limpar filtros
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export type { CategoryProductsClientProps };
