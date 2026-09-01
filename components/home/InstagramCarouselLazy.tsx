"use client";

import dynamic from "next/dynamic";
import { InstagramCarouselSkeleton } from "./InstagramCarouselSkeleton";

export const InstagramCarouselLazy = dynamic(
  () =>
    import("./InstagramCarousel").then((module) => module.InstagramCarousel),
  { ssr: false, loading: () => <InstagramCarouselSkeleton /> },
);
