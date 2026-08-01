import type { CustomerListRecord, CustomerListType } from "./types";

async function request(
  listType: CustomerListType,
  path = "",
  init?: RequestInit,
): Promise<CustomerListRecord[]> {
  const response = await fetch(`/api/customer-lists/${listType}${path}`, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Não foi possível atualizar sua lista.");
  return Array.isArray(body) ? (body as CustomerListRecord[]) : [];
}

export const customerListsApi = {
  list: (listType: CustomerListType) => request(listType),
  add: (listType: CustomerListType, productId: number) =>
    request(listType, "", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    }),
  remove: (listType: CustomerListType, productId: number) =>
    request(listType, `/${productId}`, { method: "DELETE" }),
  sync: (listType: CustomerListType, ids: number[]) =>
    request(listType, "/sync", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids),
    }),
};
