"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { A11y, Autoplay, Navigation, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper";
import type { ProductCategory } from "@/types/category";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

interface HomeCategoryCarouselProps {
  categories: ProductCategory[];
}

const CATEGORY_FALLBACK = "/images/placeholders/category-placeholder.svg";

export function HomeCategoryCarousel({
  categories,
}: HomeCategoryCarouselProps) {
  const swiperRef = useRef<SwiperInstance | null>(null);
  const carouselId = useId().replaceAll(":", "");
  const previousClass = `home-category-previous-${carouselId}`;
  const nextClass = `home-category-next-${carouselId}`;
  const paginationClass = `home-category-pagination-${carouselId}`;
  const [hasOverflow, setHasOverflow] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

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

    if (hasOverflow && !prefersReducedMotion) {
      swiper.autoplay.start();
    } else {
      swiper.autoplay.stop();
    }
  }, [hasOverflow, prefersReducedMotion]);

  if (categories.length === 0) return null;

  function updateOverflow(swiper: SwiperInstance) {
    setHasOverflow(!swiper.isLocked);
  }

  function pauseAutoplay() {
    swiperRef.current?.autoplay?.stop();
  }

  function resumeAutoplay() {
    if (hasOverflow && !prefersReducedMotion) {
      swiperRef.current?.autoplay?.start();
    }
  }

  return (
    <section
      className="group/categories relative"
      aria-labelledby="home-categories-title"
      onFocusCapture={pauseAutoplay}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          resumeAutoplay();
        }
      }}
    >
      <h2
        id="home-categories-title"
        className="text-2xl font-bold text-[#0c2d72]"
      >
        Todas as categorias
      </h2>

      <Swiper
        modules={[Navigation, Pagination, Autoplay, A11y]}
        slidesPerView={3}
        slidesPerGroup={3}
        spaceBetween={8}
        speed={600}
        rewind
        watchOverflow
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
          480: { slidesPerView: 4, slidesPerGroup: 4, spaceBetween: 10 },
          640: { slidesPerView: 5, slidesPerGroup: 5, spaceBetween: 12 },
          768: { slidesPerView: 6, slidesPerGroup: 6, spaceBetween: 14 },
          1024: { slidesPerView: 8, slidesPerGroup: 8, spaceBetween: 16 },
          1280: { slidesPerView: 10, slidesPerGroup: 10, spaceBetween: 16 },
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
        className="mt-5 pb-7!"
      >
        {categories.map((category) => (
          <SwiperSlide key={category.id} className="h-auto!">
            <Link
              href={`/categoria/${category.slug}`}
              className="group/item flex h-full w-full flex-col items-center rounded-[6px] text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72] focus-visible:ring-offset-2"
              aria-label={`Ver categoria ${category.name}`}
            >
              <span className="flex aspect-square w-14 items-center justify-center overflow-hidden rounded-full bg-white p-1 ring-1 ring-slate-200 sm:w-16 lg:w-20">
                <Image
                  src={category.image?.src ?? CATEGORY_FALLBACK}
                  alt={category.image?.alt || category.name}
                  width={80}
                  height={80}
                  sizes="(min-width: 1024px) 80px, (min-width: 640px) 64px, 56px"
                  className="h-full w-full rounded-full object-contain transition-transform group-hover/item:scale-105"
                />
              </span>
              <span className="mt-2 line-clamp-3 text-xs font-medium leading-4 text-slate-700 sm:text-sm">
                {category.name}
              </span>
            </Link>
          </SwiperSlide>
        ))}
      </Swiper>

      <button
        type="button"
        className={`${previousClass} absolute top-[4.75rem] left-0 z-10 h-10 w-10 -translate-x-1/3 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm transition-opacity hover:text-[#ff6a00] focus-visible:opacity-100 ${
          hasOverflow
            ? "hidden lg:flex lg:group-hover/categories:opacity-100"
            : "hidden"
        }`}
        aria-label="Ver categorias anteriores"
        aria-hidden={!hasOverflow}
        disabled={!hasOverflow}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`${nextClass} absolute top-[4.75rem] right-0 z-10 h-10 w-10 translate-x-1/3 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm transition-opacity hover:text-[#ff6a00] focus-visible:opacity-100 ${
          hasOverflow
            ? "hidden lg:flex lg:group-hover/categories:opacity-100"
            : "hidden"
        }`}
        aria-label="Ver próximas categorias"
        aria-hidden={!hasOverflow}
        disabled={!hasOverflow}
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
      <div
        className={`${paginationClass} absolute inset-x-0 bottom-0 z-10 h-4 items-center justify-center gap-2 ${
          hasOverflow ? "flex" : "hidden"
        } [&_.swiper-pagination-bullet-active]:bg-slate-700 [&_.swiper-pagination-bullet]:m-0! [&_.swiper-pagination-bullet]:h-2 [&_.swiper-pagination-bullet]:w-2 [&_.swiper-pagination-bullet]:bg-slate-400`}
        aria-label="Paginação das categorias"
        aria-hidden={!hasOverflow}
      />
    </section>
  );
}
