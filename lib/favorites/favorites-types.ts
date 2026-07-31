export interface FavoriteRecord { productId: number; createdAt: string; }
export function normalizeFavoriteIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0))];
}
