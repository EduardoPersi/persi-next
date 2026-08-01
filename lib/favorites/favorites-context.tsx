"use client";

import { useMemo } from "react";
import { useCustomerLists } from "@/lib/customer-lists/hooks";

export function useFavorites() {
  const customerLists = useCustomerLists();
  const favorites = customerLists.getList("favorites");

  return useMemo(
    () => ({
      favorites,
      count: customerLists.count("favorites"),
      isReady: customerLists.isReady,
      addFavorite: (productId: number) =>
        customerLists.add("favorites", productId),
      removeFavorite: (productId: number) =>
        customerLists.remove("favorites", productId),
      toggleFavorite: (productId: number) =>
        customerLists.toggle("favorites", productId),
      isFavorite: (productId: number) =>
        customerLists.contains("favorites", productId),
      sync: customerLists.sync,
      refresh: customerLists.refresh,
    }),
    [customerLists, favorites],
  );
}
