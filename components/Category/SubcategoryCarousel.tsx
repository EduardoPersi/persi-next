"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { A11y, Autoplay, Navigation, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper";
import type { ProductCategory } from "@/types/category";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

interface SubcategoryCarouselProps {
  category: ProductCategory;
  subcategories: ProductCategory[];
  pathname: string;
  selectedSlug?: string;
  includeMainCategory?: boolean;
  autoplay?: boolean;
  onSelect?: (category: ProductCategory) => void;
}

const CATEGORY_FALLBACK = "/images/placeholders/category-placeholder.svg";

export function SubcategoryCarousel({
  category,
  subcategories,
  pathname,
  selectedSlug,
  includeMainCategory = true,
  autoplay = true,
  onSelect,
}: SubcategoryCarouselProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const swiperRef = useRef<SwiperInstance | null>(null);
  const carouselId = useId().replaceAll(":", "");
  const previousClass = `subcategory-previous-${carouselId}`;
  const nextClass = `subcategory-next-${carouselId}`;
  const paginationClass = `subcategory-pagination-${carouselId}`;
  const [isPending, startTransition] = useTransition();
  const [hasOverflow, setHasOverflow] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const items = includeMainCategory
    ? [category, ...subcategories]
    : subcategories;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);

    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const swiper = swiperRef.current;

    if (!swiper?.autoplay) return;

    if (autoplay && hasOverflow && !prefersReducedMotion) {
      swiper.autoplay.start();
    } else {
      swiper.autoplay.stop();
    }
  }, [autoplay, hasOverflow, prefersReducedMotion]);

  function updateOverflow(swiper: SwiperInstance) {
    setHasOverflow(!swiper.isLocked);
  }

  function selectSubcategory(item: ProductCategory) {
    const params = new URLSearchParams(searchParams.toString());
    const isMainCategory = item.id === category.id;

    if (isMainCategory) {
      params.delete("subcategoria");
    } else {
      params.set("subcategoria", item.slug);
    }
    params.delete("pagina");

    onSelect?.(item);

    const query = params.toString();
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    });
  }

  function pauseAutoplay() {
    swiperRef.current?.autoplay?.stop();
  }

  function resumeAutoplay() {
    if (autoplay && hasOverflow && !prefersReducedMotion) {
      swiperRef.current?.autoplay?.start();
    }
  }

  if (subcategories.length === 0) return null;

  return (
    <section
      className="group/subcategories relative mt-8"
      aria-label="Selecionar subcategoria"
      aria-busy={isPending}
      onFocusCapture={pauseAutoplay}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          resumeAutoplay();
        }
      }}
    >
      <Swiper
        modules={[Navigation, Pagination, Autoplay, A11y]}
        slidesPerView={3}
        slidesPerGroup={3}
        spaceBetween={8}
        speed={600}
        rewind
        watchOverflow
        observer
        observeParents
        navigation={{
          prevEl: `.${previousClass}`,
          nextEl: `.${nextClass}`,
        }}
        pagination={{
          el: `.${paginationClass}`,
          clickable: true,
        }}
        autoplay={{
          delay: 3800,
          disableOnInteraction: false,
          pauseOnMouseEnter: true,
        }}
        breakpoints={{
          480: {
            slidesPerView: 4,
            slidesPerGroup: 4,
            spaceBetween: 10,
          },
          640: {
            slidesPerView: 5,
            slidesPerGroup: 5,
            spaceBetween: 12,
          },
          768: {
            slidesPerView: 6,
            slidesPerGroup: 6,
            spaceBetween: 14,
          },
          1024: {
            slidesPerView: 8,
            slidesPerGroup: 8,
            spaceBetween: 16,
          },
          1280: {
            slidesPerView: 10,
            slidesPerGroup: 10,
            spaceBetween: 16,
          },
        }}
        onSwiper={(swiper) => {
          swiperRef.current = swiper;
          updateOverflow(swiper);
        }}
        onAfterInit={updateOverflow}
        onBreakpoint={updateOverflow}
        onResize={updateOverflow}
        onLock={() => setHasOverflow(false)}
        onUnlock={() => setHasOverflow(true)}
        className="pb-7!"
      >
        {items.map((item) => {
          const isSelected =
            includeMainCategory && item.id === category.id
              ? !selectedSlug
              : item.slug === selectedSlug;

          return (
            <SwiperSlide key={item.id} className="h-auto!">
              <button
                type="button"
                onClick={() => selectSubcategory(item)}
                disabled={isPending}
                aria-pressed={isSelected}
                aria-current={isSelected ? "page" : undefined}
                className="group/item flex h-full w-full flex-col items-center text-center disabled:cursor-wait disabled:opacity-60"
              >
                <span
                  className={`flex aspect-square w-14 items-center justify-center overflow-hidden rounded-full bg-white p-1 transition-[box-shadow] sm:w-16 lg:w-20 ${
                    isSelected
                      ? "ring-2 ring-[#ff6a00] ring-offset-2"
                      : "ring-1 ring-slate-200"
                  }`}
                >
                  <Image
                    src={item.image?.src ?? CATEGORY_FALLBACK}
                    alt={item.image?.alt || item.name}
                    width={80}
                    height={80}
                    sizes="(min-width: 1024px) 80px, (min-width: 640px) 64px, 56px"
                    className="h-full w-full rounded-full object-contain transition-transform group-hover/item:scale-105"
                  />
                </span>
                <span
                  className={`mt-2 line-clamp-3 text-xs font-medium leading-4 sm:text-sm ${
                    isSelected ? "text-[#ff6a00]" : "text-slate-700"
                  }`}
                >
                  {item.name}
                </span>
              </button>
            </SwiperSlide>
          );
        })}
      </Swiper>

      <button
        type="button"
        className={`${previousClass} absolute top-10 left-0 z-10 h-10 w-10 -translate-x-1/3 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm transition-opacity hover:text-[#ff6a00] focus-visible:opacity-100 ${
          hasOverflow
            ? "hidden lg:flex lg:group-hover/subcategories:opacity-100"
            : "hidden"
        }`}
        aria-label="Ver subcategorias anteriores"
        aria-hidden={!hasOverflow}
        disabled={!hasOverflow}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`${nextClass} absolute top-10 right-0 z-10 h-10 w-10 translate-x-1/3 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm transition-opacity hover:text-[#ff6a00] focus-visible:opacity-100 ${
          hasOverflow
            ? "hidden lg:flex lg:group-hover/subcategories:opacity-100"
            : "hidden"
        }`}
        aria-label="Ver próximas subcategorias"
        aria-hidden={!hasOverflow}
        disabled={!hasOverflow}
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
      <div
        className={`${paginationClass} absolute inset-x-0 bottom-0 z-10 h-4 items-center justify-center gap-2 ${
          hasOverflow ? "flex" : "hidden"
        } [&_.swiper-pagination-bullet-active]:bg-slate-700 [&_.swiper-pagination-bullet]:m-0! [&_.swiper-pagination-bullet]:h-2 [&_.swiper-pagination-bullet]:w-2 [&_.swiper-pagination-bullet]:bg-slate-400`}
        aria-label="Paginação das subcategorias"
        aria-hidden={!hasOverflow}
      />
    </section>
  );
}
