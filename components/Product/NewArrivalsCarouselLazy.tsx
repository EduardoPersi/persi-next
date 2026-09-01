"use client";

import dynamic from "next/dynamic";
import { NewArrivalsCarouselSkeleton } from "./NewArrivalsCarouselSkeleton";

export const NewArrivalsCarouselLazy = dynamic(
  () =>
    import("./NewArrivalsCarousel").then(
      (module) => module.NewArrivalsCarousel,
    ),
  { ssr: false, loading: () => <NewArrivalsCarouselSkeleton /> },
);
