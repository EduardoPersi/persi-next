export const CUSTOMER_LIST_TYPES = ["favorites"] as const;

export type CustomerListType = (typeof CUSTOMER_LIST_TYPES)[number];
export type CustomerLists = Record<CustomerListType, number[]>;

export interface CustomerListRecord {
  productId: number;
  createdAt: string;
  updatedAt: string;
}

export function normalizeProductIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is number =>
          typeof id === "number" && Number.isInteger(id) && id > 0,
      ),
    ),
  ];
}

export function createEmptyCustomerLists(): CustomerLists {
  return CUSTOMER_LIST_TYPES.reduce<CustomerLists>(
    (lists, listType) => ({ ...lists, [listType]: [] }),
    { favorites: [] },
  );
}
