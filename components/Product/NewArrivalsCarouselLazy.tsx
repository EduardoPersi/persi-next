"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { DeferUntilNearViewport } from "@/components/UI/DeferUntilNearViewport";
import type { NewArrivalsCarousel } from "./NewArrivalsCarousel";
import { NewArrivalsCarouselSkeleton } from "./NewArrivalsCarouselSkeleton";

const NewArrivalsCarouselDynamic = dynamic(
  () =>
    import("./NewArrivalsCarousel").then(
      (module) => module.NewArrivalsCarousel,
    ),
  { ssr: false, loading: () => <NewArrivalsCarouselSkeleton /> },
);

export function NewArrivalsCarouselLazy(
  props: ComponentProps<typeof NewArrivalsCarousel>,
) {
  return (
    <DeferUntilNearViewport fallback={<NewArrivalsCarouselSkeleton />}>
      <NewArrivalsCarouselDynamic {...props} />
    </DeferUntilNearViewport>
  );
}
