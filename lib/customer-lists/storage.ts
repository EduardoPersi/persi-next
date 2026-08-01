import {
  CUSTOMER_LIST_TYPES,
  createEmptyCustomerLists,
  normalizeProductIds,
  type CustomerLists,
  type CustomerListType,
} from "./types";

export const CUSTOMER_LISTS_STORAGE_KEY = "customer_lists";
const LEGACY_FAVORITES_STORAGE_KEY = "persi_favorite_products";

export function readStoredCustomerLists(): CustomerLists {
  const lists = createEmptyCustomerLists();
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(CUSTOMER_LISTS_STORAGE_KEY) ?? "{}",
    );
    if (typeof parsed === "object" && parsed !== null) {
      for (const listType of CUSTOMER_LIST_TYPES) {
        lists[listType] = normalizeProductIds(
          (parsed as Record<string, unknown>)[listType],
        );
      }
    }
    const legacyFavorites = normalizeProductIds(
      JSON.parse(localStorage.getItem(LEGACY_FAVORITES_STORAGE_KEY) ?? "[]"),
    );
    lists.favorites = [...new Set([...lists.favorites, ...legacyFavorites])];
  } catch {
    return lists;
  }
  return lists;
}

export function writeStoredCustomerLists(lists: CustomerLists): void {
  const normalized = createEmptyCustomerLists();
  for (const listType of CUSTOMER_LIST_TYPES) {
    normalized[listType] = normalizeProductIds(lists[listType]);
  }
  localStorage.setItem(CUSTOMER_LISTS_STORAGE_KEY, JSON.stringify(normalized));
  localStorage.removeItem(LEGACY_FAVORITES_STORAGE_KEY);
}

export function writeStoredCustomerList(
  listType: CustomerListType,
  ids: number[],
): void {
  const lists = readStoredCustomerLists();
  lists[listType] = normalizeProductIds(ids);
  writeStoredCustomerLists(lists);
}

export function clearStoredCustomerLists(): void {
  localStorage.removeItem(CUSTOMER_LISTS_STORAGE_KEY);
  localStorage.removeItem(LEGACY_FAVORITES_STORAGE_KEY);
}
