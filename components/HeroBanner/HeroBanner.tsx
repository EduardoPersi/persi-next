"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { A11y, Autoplay, Navigation, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

const SLIDES = [
  {
    id: 1,
    desktopImage:
      "/images/slides/slide-01-impermeabilizantes-desktop.webp",
    mobileImage:
      "/images/slides/slide-01-impermeabilizantes-mobile.webp",
    title: "Impermeabilizantes para sua obra",
    description: "Soluções Viapol e Mactra para proteger cada etapa da construção.",
    href: "/busca?q=impermeabilizantes",
    alt: "Impermeabilizantes Viapol e Mactra disponíveis na Persi Materiais",
  },
  {
    id: 2,
    desktopImage:
      "/images/slides/slide-02-pex-gas-desktop.webp",
    mobileImage:
      "/images/slides/slide-02-pex-gas-mobile.webp",
    title: "Linha PEX para gás",
    description: "Tubos e conexões Astra para instalações de gás seguras e eficientes.",
    href: "/busca?q=pex+gas+astra",
    alt: "Tubos e conexões PEX para gás da Astra",
  },
  {
    id: 3,
    desktopImage:
      "/images/slides/slide-03-fortlev-desktop.webp",
    mobileImage:
      "/images/slides/slide-03-fortlev-mobile.webp",
    title: "Tubos e conexões Fortlev",
    description: "Qualidade e confiança para instalações hidráulicas residenciais e comerciais.",
    href: "/busca?q=tubos+conexoes+fortlev",
    alt: "Tubos e conexões hidráulicas Fortlev",
  },
  {
    id: 4,
    desktopImage:
      "/images/slides/slide-04-pex-agua-desktop.webp",
    mobileImage:
      "/images/slides/slide-04-pex-agua-mobile.webp",
    title: "Linha PEX para água",
    description: "Soluções Astra para água fria e quente com instalação prática.",
    href: "/busca?q=pex+agua+astra",
    alt: "Tubos e conexões PEX Astra para água fria e quente",
  },
] as const;

export function HeroBanner() {
  const swiperRef = useRef<SwiperInstance | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    const autoplay = swiperRef.current?.autoplay;
    if (!autoplay) return;

    if (prefersReducedMotion) autoplay.stop();
    else autoplay.start();
  }, [prefersReducedMotion]);

  function pauseAutoplay() {
    swiperRef.current?.autoplay?.stop();
  }

  function resumeAutoplay() {
    if (!prefersReducedMotion) swiperRef.current?.autoplay?.start();
  }

  return (
    <section
      aria-label="Destaques da Persi Materiais"
      className="group/hero relative overflow-hidden bg-slate-900"
      onMouseEnter={pauseAutoplay}
      onMouseLeave={resumeAutoplay}
      onFocusCapture={pauseAutoplay}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) resumeAutoplay();
      }}
    >
      <Swiper
        modules={[Autoplay, Navigation, Pagination, A11y]}
        slidesPerView={1}
        loop
        speed={650}
        autoplay={{ delay: 6000, disableOnInteraction: false }}
        navigation={{
          prevEl: ".hero-banner-previous",
          nextEl: ".hero-banner-next",
        }}
        pagination={{ clickable: true, el: ".hero-banner-pagination" }}
        onSwiper={(swiper) => {
          swiperRef.current = swiper;
        }}
        a11y={{
          prevSlideMessage: "Slide anterior",
          nextSlideMessage: "Próximo slide",
          paginationBulletMessage: "Ir para o slide {{index}}",
        }}
      >
        {SLIDES.map((slide, index) => (
          <SwiperSlide key={slide.id}>
            <div className="relative aspect-[4/5] w-full lg:aspect-auto lg:h-[clamp(360px,26vw,500px)]">
              <picture>
                <source media="(min-width: 1024px)" srcSet={slide.desktopImage} />
                <img
                  src={slide.mobileImage}
                  alt={slide.alt}
                  width={768}
                  height={960}
                  loading={index === 0 ? "eager" : "lazy"}
                  fetchPriority={index === 0 ? "high" : "auto"}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </picture>
              <div className="absolute inset-0 flex items-center justify-center px-12 py-12 sm:px-[30%] sm:py-8">
                <div className="max-w-xl text-center text-white [text-shadow:0_2px_8px_rgb(0_0_0/55%)]">
                  <h2 className="text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">
                    {slide.title}
                  </h2>
                  <p className="mt-3 text-base font-medium sm:text-lg lg:text-xl">
                    {slide.description}
                  </p>
                  <Link
                    href={slide.href}
                    className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#ff6a00] px-6 py-3 font-semibold text-white no-underline shadow-md transition hover:bg-[#e85f00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#ff6a00]"
                  >
                    Ver produtos
                  </Link>
                </div>
              </div>
            </div>
          </SwiperSlide>
        ))}
      </Swiper>

      <button
        type="button"
        aria-label="Slide anterior"
        className="hero-banner-previous absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#0c2d72] shadow-md transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6a00] sm:left-4"
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Próximo slide"
        className="hero-banner-next absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#0c2d72] shadow-md transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6a00] sm:right-4"
      >
        <ChevronRight aria-hidden="true" />
      </button>
      <div className="hero-banner-pagination absolute! bottom-3! z-10! flex justify-center [&_.swiper-pagination-bullet]:h-2.5 [&_.swiper-pagination-bullet]:w-2.5 [&_.swiper-pagination-bullet]:bg-white [&_.swiper-pagination-bullet]:opacity-70 [&_.swiper-pagination-bullet-active]:w-7 [&_.swiper-pagination-bullet-active]:rounded-full [&_.swiper-pagination-bullet-active]:bg-[#ff6a00] [&_.swiper-pagination-bullet-active]:opacity-100" />
    </section>
  );
}
