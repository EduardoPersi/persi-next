"use client";

import dynamic from "next/dynamic";

export const BrandCarouselLazy = dynamic(
  () => import("./BrandCarousel").then((module) => module.BrandCarousel),
  { ssr: false, loading: () => null },
);
