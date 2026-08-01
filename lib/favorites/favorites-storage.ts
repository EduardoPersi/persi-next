import {
  CUSTOMER_LISTS_STORAGE_KEY,
  clearStoredCustomerLists,
  readStoredCustomerLists,
  writeStoredCustomerList,
} from "@/lib/customer-lists/storage";

export const FAVORITES_STORAGE_KEY = CUSTOMER_LISTS_STORAGE_KEY;
export const readStoredFavorites = () => readStoredCustomerLists().favorites;
export const writeStoredFavorites = (ids: number[]) =>
  writeStoredCustomerList("favorites", ids);
export const clearStoredFavorites = clearStoredCustomerLists;
