import type { FavoriteRecord } from "./favorites-types";
async function request(path = "", init?: RequestInit): Promise<FavoriteRecord[]> {
  const response = await fetch(`/api/favorites${path}`, { ...init, cache: "no-store", credentials: "same-origin" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Não foi possível atualizar seus favoritos.");
  return Array.isArray(body) ? body as FavoriteRecord[] : [];
}
export const favoritesApi = {
  list: () => request(),
  add: (productId: number) => request("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId }) }),
  remove: (productId: number) => request(`/${productId}`, { method: "DELETE" }),
  sync: (ids: number[]) => request("/sync", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids) }),
};
