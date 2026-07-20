"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { A11y, Navigation } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import {
  RECENTLY_VIEWED_LIMIT,
  RECENTLY_VIEWED_STORAGE_KEY,
} from "./RecentlyViewedTracker";
import {
  RecentlyViewedProductCard,
  type RecentlyViewedProductData,
} from "./RecentlyViewedProductCard";
import "swiper/css";
import "swiper/css/navigation";

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

export function RecentlyViewedProducts() {
  const storedValue = useSyncExternalStore(
    subscribeToStorage,
    getStoredValue,
    getServerStoredValue,
  );
  const slugs = useMemo(
    () => readStoredSlugs(storedValue),
    [storedValue],
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

  if (slugs.length === 0 || (products && products.length === 0)) return null;
  const isLoading = products === null;

  return (
    <section
      className="mt-12"
      aria-labelledby="recently-viewed-title"
      aria-busy={isLoading}
    >
      <h2
        id="recently-viewed-title"
        className="text-xl font-semibold text-slate-900 sm:text-2xl"
      >
        Produtos visualizados recentemente
      </h2>

      {isLoading ? (
        <div className="mt-5 flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="h-32 min-w-[80%] animate-pulse rounded-[6px] bg-slate-200 sm:min-w-[40%] lg:min-w-[24%]"
            />
          ))}
        </div>
      ) : products.length === 1 ? (
        <div className="mt-5 max-w-sm">
          <RecentlyViewedProductCard product={products[0]} />
        </div>
      ) : (
        <Swiper
          modules={[Navigation, A11y]}
          slidesPerView={1.25}
          spaceBetween={12}
          watchOverflow
          breakpoints={{
            480: { slidesPerView: 1.5, spaceBetween: 12 },
            640: { slidesPerView: 2.5, spaceBetween: 14 },
            768: { slidesPerView: 3, spaceBetween: 16 },
            1024: { slidesPerView: 4, spaceBetween: 16 },
            1280: { slidesPerView: 5, spaceBetween: 16 },
          }}
          className="mt-5"
        >
          {products.map((product) => (
            <SwiperSlide key={product.id} className="h-auto!">
              <RecentlyViewedProductCard product={product} />
            </SwiperSlide>
          ))}
        </Swiper>
      )}
    </section>
  );
}
