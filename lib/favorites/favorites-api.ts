import { customerListsApi } from "@/lib/customer-lists/api";

export const favoritesApi = {
  list: () => customerListsApi.list("favorites"),
  add: (productId: number) => customerListsApi.add("favorites", productId),
  remove: (productId: number) => customerListsApi.remove("favorites", productId),
  sync: (ids: number[]) => customerListsApi.sync("favorites", ids),
};
