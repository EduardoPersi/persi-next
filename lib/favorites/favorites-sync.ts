import { favoritesApi } from "./favorites-api";
import { clearStoredFavorites, readStoredFavorites } from "./favorites-storage";
export async function mergeAnonymousFavorites(): Promise<number[]> {
  const server = await favoritesApi.list();
  const merged = [...new Set([...server.map((item) => item.productId), ...readStoredFavorites()])];
  const synchronized = await favoritesApi.sync(merged);
  clearStoredFavorites();
  return synchronized.map((item) => item.productId);
}
