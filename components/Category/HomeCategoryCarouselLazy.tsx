"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { DeferUntilNearViewport } from "@/components/UI/DeferUntilNearViewport";
import type { HomeCategoryCarousel } from "./HomeCategoryCarousel";
import { HomeCategoryCarouselSkeleton } from "./HomeCategoryCarouselSkeleton";

const HomeCategoryCarouselDynamic = dynamic(
  () =>
    import("./HomeCategoryCarousel").then(
      (module) => module.HomeCategoryCarousel,
    ),
  { ssr: false, loading: () => <HomeCategoryCarouselSkeleton /> },
);

export function HomeCategoryCarouselLazy(
  props: ComponentProps<typeof HomeCategoryCarousel>,
) {
  return (
    <DeferUntilNearViewport fallback={<HomeCategoryCarouselSkeleton />}>
      <HomeCategoryCarouselDynamic {...props} />
    </DeferUntilNearViewport>
  );
}
