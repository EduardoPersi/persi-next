"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { A11y, Navigation } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper";
import type { InstagramFeedItem } from "@/types/instagram";
import { InstagramCard } from "./InstagramCard";
import "swiper/css";
import "swiper/css/navigation";

interface InstagramCarouselProps {
  posts: InstagramFeedItem[];
}

export function InstagramCarousel({
  posts,
}: InstagramCarouselProps) {
  const carouselId = useId().replaceAll(":", "");
  const previousClass = `instagram-previous-${carouselId}`;
  const nextClass = `instagram-next-${carouselId}`;
  const [hasOverflow, setHasOverflow] = useState(false);

  function updateOverflow(swiper: SwiperInstance) {
    setHasOverflow(!swiper.isLocked);
  }

  return (
    <div className="group/instagram-carousel relative mt-6">
      <Swiper
        modules={[Navigation, A11y]}
        slidesPerView={1.2}
        spaceBetween={12}
        loop={posts.length > 3}
        watchOverflow
        navigation={{
          prevEl: `.${previousClass}`,
          nextEl: `.${nextClass}`,
        }}
        breakpoints={{
          480: { slidesPerView: 2, spaceBetween: 12 },
          640: { slidesPerView: 2.4, spaceBetween: 16 },
          768: { slidesPerView: 3, spaceBetween: 16 },
          1024: { slidesPerView: 3, spaceBetween: 20 },
        }}
        onSwiper={updateOverflow}
        onAfterInit={updateOverflow}
        onBreakpoint={updateOverflow}
        onResize={updateOverflow}
        onLock={() => setHasOverflow(false)}
        onUnlock={() => setHasOverflow(true)}
        aria-label="Publicações da Persi no Instagram"
      >
        {posts.map((post) => (
          <SwiperSlide key={post.id} className="h-auto!">
            <InstagramCard post={post} />
          </SwiperSlide>
        ))}
      </Swiper>

      <button
        type="button"
        className={`${previousClass} absolute left-0 top-1/2 z-10 hidden h-11 w-11 -translate-x-1/3 -translate-y-1/2 items-center justify-center rounded-full bg-white text-primary opacity-0 shadow-md transition hover:bg-primary hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 lg:flex ${
          hasOverflow
            ? "lg:group-hover/instagram-carousel:opacity-100"
            : "lg:hidden"
        }`}
        aria-label="Ver publicações anteriores do Instagram"
        disabled={!hasOverflow}
      >
        <ChevronLeft className="h-6 w-6" aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`${nextClass} absolute right-0 top-1/2 z-10 hidden h-11 w-11 translate-x-1/3 -translate-y-1/2 items-center justify-center rounded-full bg-white text-primary opacity-0 shadow-md transition hover:bg-primary hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 lg:flex ${
          hasOverflow
            ? "lg:group-hover/instagram-carousel:opacity-100"
            : "lg:hidden"
        }`}
        aria-label="Ver próximas publicações do Instagram"
        disabled={!hasOverflow}
      >
        <ChevronRight className="h-6 w-6" aria-hidden="true" />
      </button>
    </div>
  );
}
