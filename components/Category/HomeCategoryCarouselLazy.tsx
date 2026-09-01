"use client";

import dynamic from "next/dynamic";
import { HomeCategoryCarouselSkeleton } from "./HomeCategoryCarouselSkeleton";

export const HomeCategoryCarouselLazy = dynamic(
  () =>
    import("./HomeCategoryCarousel").then(
      (module) => module.HomeCategoryCarousel,
    ),
  { ssr: false, loading: () => <HomeCategoryCarouselSkeleton /> },
);
