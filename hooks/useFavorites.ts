"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const FAVORITES_STORAGE_KEY = "persi_favorite_products";
const FAVORITES_CHANGE_EVENT = "persi:favorites-change";
let memoryFavorites = "[]";

function normalizeFavorites(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value.filter(
        (item): item is number =>
          typeof item === "number" &&
          Number.isInteger(item) &&
          item > 0,
      ),
    ),
  ];
}

function parseFavorites(value: string): number[] {
  try {
    return normalizeFavorites(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

function getFavoritesSnapshot() {
  try {
    const storedValue = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (storedValue !== null) {
      memoryFavorites = JSON.stringify(parseFavorites(storedValue));
    }
  } catch {
    // O fallback em memória mantém os favoritos funcionais nesta sessão.
  }

  return memoryFavorites;
}

function getServerFavoritesSnapshot() {
  return "[]";
}

function subscribeToFavorites(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === FAVORITES_STORAGE_KEY) onStoreChange();
  };
  const handleFavoritesChange = () => onStoreChange();

  window.addEventListener("storage", handleStorage);
  window.addEventListener(FAVORITES_CHANGE_EVENT, handleFavoritesChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(
      FAVORITES_CHANGE_EVENT,
      handleFavoritesChange,
    );
  };
}

function persistFavorites(ids: number[]) {
  memoryFavorites = JSON.stringify(normalizeFavorites(ids));

  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, memoryFavorites);
  } catch {
    // O estado em memória ainda permite favoritar durante a sessão.
  }

  window.dispatchEvent(new Event(FAVORITES_CHANGE_EVENT));
}

export function useFavorites() {
  const snapshot = useSyncExternalStore(
    subscribeToFavorites,
    getFavoritesSnapshot,
    getServerFavoritesSnapshot,
  );
  const favoriteIds = useMemo(() => parseFavorites(snapshot), [snapshot]);

  const addFavorite = useCallback((productId: number) => {
    const currentIds = parseFavorites(getFavoritesSnapshot());
    if (!currentIds.includes(productId)) {
      persistFavorites([...currentIds, productId]);
    }
  }, []);

  const removeFavorite = useCallback((productId: number) => {
    persistFavorites(
      parseFavorites(getFavoritesSnapshot()).filter(
        (id) => id !== productId,
      ),
    );
  }, []);

  const toggleFavorite = useCallback((productId: number) => {
    const currentIds = parseFavorites(getFavoritesSnapshot());
    persistFavorites(
      currentIds.includes(productId)
        ? currentIds.filter((id) => id !== productId)
        : [...currentIds, productId],
    );
  }, []);

  const isFavorite = useCallback(
    (productId: number) => favoriteIds.includes(productId),
    [favoriteIds],
  );

  return {
    favoriteIds,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isFavorite,
  };
}
