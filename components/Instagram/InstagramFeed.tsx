"use client";

import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  Images,
  Play,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { A11y, Navigation } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper";
import type { InstagramFeedItem } from "@/types/instagram";
import "swiper/css";
import "swiper/css/navigation";

interface InstagramFeedProps {
  posts: InstagramFeedItem[];
}

function getPostDescription(caption?: string) {
  if (!caption) {
    return "Publicação da Persi Materiais no Instagram";
  }

  const description = caption
    .replace(/#\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return (
    description.slice(0, 120) ||
    "Publicação da Persi Materiais no Instagram"
  );
}

export function InstagramFeed({ posts }: InstagramFeedProps) {
  const swiperRef = useRef<SwiperInstance | null>(null);
  const carouselId = useId().replaceAll(":", "");
  const previousClass = `instagram-previous-${carouselId}`;
  const nextClass = `instagram-next-${carouselId}`;
  const [hasOverflow, setHasOverflow] = useState(false);

  if (posts.length === 0) return null;

  function updateOverflow(swiper: SwiperInstance) {
    setHasOverflow(!swiper.isLocked);
  }

  return (
    <section
      className="group/instagram relative mt-12"
      aria-labelledby="instagram-feed-title"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2
          id="instagram-feed-title"
          className="text-xl font-bold text-foreground sm:text-2xl"
        >
          Siga a gente no Instagram
        </h2>
        <a
          href="https://www.instagram.com/persimateriais/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Acessar o Instagram da Persi Materiais"
          className="text-sm font-semibold text-primary transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          @persimateriais
        </a>
      </div>

      <Swiper
        modules={[Navigation, A11y]}
        slidesPerView={1.3}
        spaceBetween={12}
        watchOverflow
        navigation={{
          prevEl: `.${previousClass}`,
          nextEl: `.${nextClass}`,
        }}
        breakpoints={{
          480: { slidesPerView: 2, spaceBetween: 12 },
          640: { slidesPerView: 2.5, spaceBetween: 14 },
          768: { slidesPerView: 3, spaceBetween: 16 },
          1024: { slidesPerView: 4, spaceBetween: 16 },
          1280: { slidesPerView: 4, spaceBetween: 16 },
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
        className="mt-5"
      >
        {posts.map((post) => {
          const description = getPostDescription(post.caption);
          const isVideo =
            post.mediaType === "VIDEO" || post.mediaType === "REELS";
          const isCarousel = post.mediaType === "CAROUSEL_ALBUM";

          return (
            <SwiperSlide key={post.id} className="h-auto!">
              <a
                href={post.permalink}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${description}. Abrir publicação no Instagram`}
                className="group/post relative block aspect-square overflow-hidden rounded-xl bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <Image
                  src={`/api/instagram/media/${encodeURIComponent(post.id)}`}
                  alt={description}
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, (min-width: 480px) 50vw, 77vw"
                  className="object-cover transition-transform duration-300 group-hover/post:scale-[1.03]"
                />

                {isVideo ? (
                  <span className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950/70 text-white">
                    <Play
                      className="h-5 w-5 fill-current"
                      aria-hidden="true"
                    />
                    <span className="sr-only">Vídeo ou Reel</span>
                  </span>
                ) : null}

                {isCarousel ? (
                  <span className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950/70 text-white">
                    <Images className="h-5 w-5" aria-hidden="true" />
                    <span className="sr-only">Publicação com várias imagens</span>
                  </span>
                ) : null}

                <span className="absolute inset-0 flex items-center justify-center bg-slate-950/40 text-white opacity-0 transition-opacity group-hover/post:opacity-100 group-focus-visible/post:opacity-100">
                  <span className="inline-flex items-center gap-2 rounded-xl bg-slate-950/70 px-3 py-2 text-sm font-semibold">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 fill-none stroke-current"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="5" />
                      <circle cx="12" cy="12" r="4" />
                      <circle
                        cx="17.5"
                        cy="6.5"
                        r="1"
                        fill="currentColor"
                        stroke="none"
                      />
                    </svg>
                    Ver no Instagram
                  </span>
                </span>
              </a>
            </SwiperSlide>
          );
        })}
      </Swiper>

      <button
        type="button"
        className={`${previousClass} absolute left-0 top-1/2 z-10 h-10 w-10 -translate-x-1/3 items-center justify-center rounded-full bg-white/90 text-foreground opacity-0 shadow-sm transition-opacity hover:text-secondary focus-visible:opacity-100 ${
          hasOverflow
            ? "hidden lg:flex lg:group-hover/instagram:opacity-100"
            : "hidden"
        }`}
        aria-label="Ver publicações anteriores do Instagram"
        aria-hidden={!hasOverflow}
        disabled={!hasOverflow}
      >
        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`${nextClass} absolute right-0 top-1/2 z-10 h-10 w-10 translate-x-1/3 items-center justify-center rounded-full bg-white/90 text-foreground opacity-0 shadow-sm transition-opacity hover:text-secondary focus-visible:opacity-100 ${
          hasOverflow
            ? "hidden lg:flex lg:group-hover/instagram:opacity-100"
            : "hidden"
        }`}
        aria-label="Ver próximas publicações do Instagram"
        aria-hidden={!hasOverflow}
        disabled={!hasOverflow}
      >
        <ChevronRight className="h-5 w-5" aria-hidden="true" />
      </button>
    </section>
  );
}
