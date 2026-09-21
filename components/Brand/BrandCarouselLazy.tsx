"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { DeferUntilNearViewport } from "@/components/UI/DeferUntilNearViewport";
import type { BrandCarousel } from "./BrandCarousel";

const BrandCarouselDynamic = dynamic(
  () => import("./BrandCarousel").then((module) => module.BrandCarousel),
  { ssr: false, loading: () => null },
);

export function BrandCarouselLazy(props: ComponentProps<typeof BrandCarousel>) {
  return (
    <DeferUntilNearViewport fallback={null}>
      <BrandCarouselDynamic {...props} />
    </DeferUntilNearViewport>
  );
}
