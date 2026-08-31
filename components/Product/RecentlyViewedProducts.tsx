"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  RECENTLY_VIEWED_LIMIT,
  RECENTLY_VIEWED_STORAGE_KEY,
} from "./RecentlyViewedTracker";
import {
  RecentlyViewedProductCard,
  type RecentlyViewedProductData,
} from "./RecentlyViewedProductCard";

function subscribeToStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getStoredValue() {
  return localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY) ?? "[]";
}

function getServerStoredValue() {
  return "[]";
}

function readStoredSlugs(storedValue: string) {
  try {
    const value: unknown = JSON.parse(storedValue);
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .slice(0, RECENTLY_VIEWED_LIMIT)
      : [];
  } catch {
    return [];
  }
}

interface RecentlyViewedProductsProps {
  title?: string;
  excludeSlug?: string;
  sectionId?: string;
  showEmptyState?: boolean;
}

export function RecentlyViewedProducts({
  title = "Produtos visualizados recentemente",
  excludeSlug,
  sectionId = "recently-viewed-title",
  showEmptyState = false,
}: RecentlyViewedProductsProps = {}) {
  const storedValue = useSyncExternalStore(
    subscribeToStorage,
    getStoredValue,
    getServerStoredValue,
  );
  const slugs = useMemo(
    () =>
      readStoredSlugs(storedValue).filter((slug) => slug !== excludeSlug),
    [excludeSlug, storedValue],
  );
  const [products, setProducts] =
    useState<RecentlyViewedProductData[] | null>(null);

  useEffect(() => {
    if (slugs.length === 0) return;

    const controller = new AbortController();

    fetch(
      `/api/catalog/recently-viewed?slugs=${encodeURIComponent(slugs.join(","))}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Falha ao carregar produtos recentes.");
        return (await response.json()) as {
          products?: RecentlyViewedProductData[];
        };
      })
      .then((data) => {
        const productsBySlug = new Map(
          (data.products ?? []).map((product) => [product.slug, product]),
        );
        const orderedProducts = slugs
          .map((slug) => productsBySlug.get(slug))
          .filter(
            (product): product is RecentlyViewedProductData =>
              product !== undefined,
          );

        setProducts(orderedProducts);
        localStorage.setItem(
          RECENTLY_VIEWED_STORAGE_KEY,
          JSON.stringify(orderedProducts.map((product) => product.slug)),
        );
      })
      .catch((error: unknown) => {
        if (
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setProducts([]);
        }
      });

    return () => controller.abort();
  }, [slugs]);

  if (slugs.length === 0 || (products && products.length === 0)) {
    return showEmptyState ? (
      <div className="mt-6 rounded-xl bg-slate-50 p-8 text-center text-muted">
        Você ainda não visualizou produtos neste dispositivo.
      </div>
    ) : null;
  }
  const isLoading = products === null;

  return (
    <section
      className="mt-12"
      aria-labelledby={sectionId}
      aria-busy={isLoading}
    >
      <h2
        id={sectionId}
        className="text-xl font-bold text-foreground sm:text-2xl"
      >
        {title}
      </h2>

      {isLoading ? (
        <div className="mt-5 flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="h-32 min-w-[80%] animate-pulse rounded-xl bg-slate-200 sm:min-w-[40%] lg:min-w-[24%]"
            />
          ))}
        </div>
      ) : products.length === 1 ? (
        <div className="mt-5 max-w-sm">
          <RecentlyViewedProductCard product={products[0]} />
        </div>
      ) : (
        <div className="mt-5 grid auto-cols-[80%] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain pb-2 snap-x snap-mandatory min-[480px]:auto-cols-[66%] sm:auto-cols-[40%] sm:gap-3.5 md:auto-cols-[calc((100%-2rem)/3)] md:gap-4 lg:auto-cols-[calc((100%-3rem)/4)] xl:auto-cols-[calc((100%-4rem)/5)]">
          {products.map((product) => (
            <div key={product.id} className="h-full snap-start">
              <RecentlyViewedProductCard product={product} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
