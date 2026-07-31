import { normalizeFavoriteIds } from "./favorites-types";
export const FAVORITES_STORAGE_KEY = "persi_favorite_products";
export function readStoredFavorites(): number[] { try { return normalizeFavoriteIds(JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) ?? "[]")); } catch { return []; } }
export function writeStoredFavorites(ids: number[]): void { localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(normalizeFavoriteIds(ids))); }
export function clearStoredFavorites(): void { localStorage.removeItem(FAVORITES_STORAGE_KEY); }
