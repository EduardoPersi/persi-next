"use client";

import { useEffect } from "react";

export const RECENTLY_VIEWED_STORAGE_KEY =
  "persi_recently_viewed_products";
export const RECENTLY_VIEWED_LIMIT = 10;

interface RecentlyViewedTrackerProps {
  slug: string;
}

function getStoredSlugs(): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(RECENTLY_VIEWED_STORAGE_KEY) ?? "[]",
    );

    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function RecentlyViewedTracker({
  slug,
}: RecentlyViewedTrackerProps) {
  useEffect(() => {
    const recentSlugs = getStoredSlugs().filter((item) => item !== slug);
    localStorage.setItem(
      RECENTLY_VIEWED_STORAGE_KEY,
      JSON.stringify([slug, ...recentSlugs].slice(0, RECENTLY_VIEWED_LIMIT)),
    );
  }, [slug]);

  return null;
}
