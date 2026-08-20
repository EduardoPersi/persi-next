"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { A11y, Autoplay, Navigation, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper";
import type { Product } from "@/types/product";
import { getProductHref } from "@/lib/routing/storefrontUrls";
import { ProductCard } from "./ProductCard";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

interface NewArrivalsCarouselProps {
  products: Product[];
}

export function NewArrivalsCarousel({ products }: NewArrivalsCarouselProps) {
  const swiperRef = useRef<SwiperInstance | null>(null);
  const carouselId = useId().replaceAll(":", "");
  const previousClass = `new-arrivals-previous-${carouselId}`;
  const nextClass = `new-arrivals-next-${carouselId}`;
  const paginationClass = `new-arrivals-pagination-${carouselId}`;
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

  if (products.length === 0) return null;

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
      className="group/new-arrivals relative"
      aria-labelledby="new-arrivals-title"
      onFocusCapture={pauseAutoplay}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          resumeAutoplay();
        }
      }}
    >
      <div>
        <h2
          id="new-arrivals-title"
          className="text-2xl font-bold text-[#0c2d72]"
        >
          Novidades na loja
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Os produtos mais recentes do nosso catálogo.
        </p>
      </div>

      <Swiper
        modules={[Navigation, Pagination, Autoplay, A11y]}
        slidesPerView={2}
        slidesPerGroup={2}
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
          delay: 4200,
          disableOnInteraction: false,
          pauseOnMouseEnter: true,
        }}
        breakpoints={{
          640: { slidesPerView: 3, slidesPerGroup: 3, spaceBetween: 16 },
          1024: { slidesPerView: 4, slidesPerGroup: 4, spaceBetween: 20 },
          1280: { slidesPerView: 5, slidesPerGroup: 5, spaceBetween: 20 },
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
        className="mt-5 pb-9!"
      >
        {products.map((product) => (
          <SwiperSlide key={product.id} className="h-auto!">
            <ProductCard
              name={product.name}
              image={product.image?.src ?? ""}
              images={product.images}
              href={getProductHref(product.slug)}
              price={product.price}
              regularPrice={product.onSale ? product.regularPrice : undefined}
              currencyCode={product.currencyCode}
              commercialText={product.commercialText}
              freeShipping={product.freeShipping}
              brand={product.brands[0]?.name}
              badge="Novo"
              available={product.available}
              productId={product.id}
              productSlug={product.slug}
            />
          </SwiperSlide>
        ))}
      </Swiper>

      <button
        type="button"
        className={`${previousClass} absolute top-[calc(50%-0.5rem)] left-0 z-10 h-10 w-10 -translate-x-1/3 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm transition-opacity hover:text-[#ff6a00] focus-visible:opacity-100 ${
          hasOverflow
            ? "hidden lg:flex lg:group-hover/new-arrivals:opacity-100"
            : "hidden"
        }`}
        aria-label="Ver novidades anteriores"
        aria-hidden={!hasOverflow}
        disabled={!hasOverflow}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`${nextClass} absolute top-[calc(50%-0.5rem)] right-0 z-10 h-10 w-10 translate-x-1/3 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm transition-opacity hover:text-[#ff6a00] focus-visible:opacity-100 ${
          hasOverflow
            ? "hidden lg:flex lg:group-hover/new-arrivals:opacity-100"
            : "hidden"
        }`}
        aria-label="Ver próximas novidades"
        aria-hidden={!hasOverflow}
        disabled={!hasOverflow}
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
      <div
        className={`${paginationClass} absolute inset-x-0 bottom-0 z-10 h-4 items-center justify-center gap-2 ${
          hasOverflow ? "flex" : "hidden"
        } [&_.swiper-pagination-bullet-active]:bg-slate-700 [&_.swiper-pagination-bullet]:m-0! [&_.swiper-pagination-bullet]:h-2 [&_.swiper-pagination-bullet]:w-2 [&_.swiper-pagination-bullet]:bg-slate-400`}
        aria-label="Paginação das novidades"
        aria-hidden={!hasOverflow}
      />
    </section>
  );
}
