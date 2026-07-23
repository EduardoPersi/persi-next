"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { A11y, Autoplay, Navigation, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper";
import type { CatalogFilterOption } from "@/types/catalog-filters";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

interface BrandCarouselProps {
  brands: CatalogFilterOption[];
  pathname: string;
  subcategorySlug?: string;
}

export function BrandCarousel({
  brands,
  pathname,
  subcategorySlug,
}: BrandCarouselProps) {
  const swiperRef = useRef<SwiperInstance | null>(null);
  const carouselId = useId().replaceAll(":", "");
  const previousClass = `brand-previous-${carouselId}`;
  const nextClass = `brand-next-${carouselId}`;
  const paginationClass = `brand-pagination-${carouselId}`;
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

  if (brands.length === 0) return null;

  function updateOverflow(swiper: SwiperInstance) {
    setHasOverflow(!swiper.isLocked);
  }

  function getBrandHref(brand: CatalogFilterOption) {
    const params = new URLSearchParams();
    if (subcategorySlug) params.set("subcategoria", subcategorySlug);
    params.set("marca", String(brand.id));
    return `${pathname}?${params.toString()}`;
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
      className="group/brands relative mt-10"
      aria-labelledby="brand-carousel-title"
      onFocusCapture={pauseAutoplay}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          resumeAutoplay();
        }
      }}
    >
      <h2
        id="brand-carousel-title"
        className="text-xl font-bold text-slate-900 sm:text-2xl"
      >
        Selecionar por marca
      </h2>

      <Swiper
        modules={[Navigation, Pagination, Autoplay, A11y]}
        slidesPerView={3}
        slidesPerGroup={3}
        spaceBetween={12}
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
          delay: 3500,
          disableOnInteraction: false,
          pauseOnMouseEnter: true,
        }}
        breakpoints={{
          480: { slidesPerView: 4, slidesPerGroup: 4, spaceBetween: 16 },
          640: { slidesPerView: 5, slidesPerGroup: 5, spaceBetween: 20 },
          768: { slidesPerView: 6, slidesPerGroup: 6, spaceBetween: 24 },
          1024: { slidesPerView: 7, slidesPerGroup: 7, spaceBetween: 28 },
          1280: { slidesPerView: 9, slidesPerGroup: 9, spaceBetween: 32 },
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
        {brands.map((brand) => (
          <SwiperSlide key={brand.id} className="h-auto!">
            <Link
              href={getBrandHref(brand)}
              className="flex h-24 w-full items-center justify-center rounded-[6px] px-2 opacity-80 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0c2d72]"
              aria-label={`Ver produtos da marca ${brand.name}`}
            >
              {brand.image ? (
                <Image
                  src={brand.image.src}
                  alt={brand.image.alt || `Logo da marca ${brand.name}`}
                  width={130}
                  height={72}
                  sizes="(min-width: 1024px) 130px, 90px"
                  className="h-auto max-h-16 w-full max-w-[90px] object-contain lg:max-w-[130px]"
                />
              ) : (
                <span className="line-clamp-2 text-center text-sm font-medium text-slate-600">
                  {brand.name}
                </span>
              )}
            </Link>
          </SwiperSlide>
        ))}
      </Swiper>

      <button
        type="button"
        className={`${previousClass} absolute top-[5.75rem] left-0 z-10 h-10 w-10 -translate-x-1/3 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm transition-opacity hover:text-[#ff6a00] focus-visible:opacity-100 ${
          hasOverflow
            ? "hidden lg:flex lg:group-hover/brands:opacity-100"
            : "hidden"
        }`}
        aria-label="Ver marcas anteriores"
        aria-hidden={!hasOverflow}
        disabled={!hasOverflow}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`${nextClass} absolute top-[5.75rem] right-0 z-10 h-10 w-10 translate-x-1/3 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm transition-opacity hover:text-[#ff6a00] focus-visible:opacity-100 ${
          hasOverflow
            ? "hidden lg:flex lg:group-hover/brands:opacity-100"
            : "hidden"
        }`}
        aria-label="Ver próximas marcas"
        aria-hidden={!hasOverflow}
        disabled={!hasOverflow}
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
      <div
        className={`${paginationClass} absolute inset-x-0 bottom-0 z-10 h-4 items-center justify-center gap-2 ${
          hasOverflow ? "flex" : "hidden"
        } [&_.swiper-pagination-bullet-active]:bg-slate-700 [&_.swiper-pagination-bullet]:m-0! [&_.swiper-pagination-bullet]:h-2 [&_.swiper-pagination-bullet]:w-2 [&_.swiper-pagination-bullet]:bg-slate-400`}
        aria-label="Paginação das marcas"
        aria-hidden={!hasOverflow}
      />
    </section>
  );
}
