import { customerListsApi } from "./api";
import { clearStoredCustomerLists, readStoredCustomerLists } from "./storage";
import {
  CUSTOMER_LIST_TYPES,
  createEmptyCustomerLists,
  type CustomerLists,
} from "./types";

export async function mergeAnonymousCustomerLists(): Promise<CustomerLists> {
  const localLists = readStoredCustomerLists();
  const synchronized = createEmptyCustomerLists();

  for (const listType of CUSTOMER_LIST_TYPES) {
    const server = await customerListsApi.list(listType);
    const merged = [
      ...new Set([
        ...server.map((item) => item.productId),
        ...localLists[listType],
      ]),
    ];
    synchronized[listType] = (
      await customerListsApi.sync(listType, merged)
    ).map((item) => item.productId);
  }

  clearStoredCustomerLists();
  return synchronized;
}
