import {
  CUSTOMER_LISTS_REST_BASE_PATH,
  AccountServiceError,
  getAccountClientConfig,
  requestAccountEndpoint,
} from "./client";
import type {
  CustomerListRecord,
  CustomerListType,
} from "@/lib/customer-lists/types";

function parse(value: unknown): CustomerListRecord[] {
  if (!Array.isArray(value)) {
    throw new AccountServiceError(502, "Invalid customer list response");
  }
  return value.filter((item): item is CustomerListRecord => {
    if (typeof item !== "object" || item === null) return false;
    const record = item as Partial<CustomerListRecord>;
    return (
      Number.isInteger(record.productId) &&
      typeof record.createdAt === "string" &&
      typeof record.updatedAt === "string"
    );
  });
}

async function call(
  token: string,
  listType: CustomerListType,
  method: "GET" | "POST" | "PUT" | "DELETE",
  suffix: "" | `/${number}` | "/sync",
  rawBody = "",
): Promise<unknown> {
  const result = await requestAccountEndpoint({
    config: getAccountClientConfig(),
    method,
    route: `/customer-lists/${listType}${suffix}`,
    basePath: CUSTOMER_LISTS_REST_BASE_PATH,
    rawBody,
    bearerToken: token,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new AccountServiceError(
      result.status === 401 ? 401 : 502,
      "Customer list unavailable",
    );
  }
  return result.body;
}

export async function listCustomerList(token: string, listType: CustomerListType) {
  return parse(await call(token, listType, "GET", ""));
}

export async function addCustomerListItem(
  token: string,
  listType: CustomerListType,
  productId: number,
) {
  return parse(
    await call(token, listType, "POST", "", JSON.stringify({ productId })),
  );
}

export async function removeCustomerListItem(
  token: string,
  listType: CustomerListType,
  productId: number,
) {
  return parse(await call(token, listType, "DELETE", `/${productId}`));
}

export async function syncCustomerList(
  token: string,
  listType: CustomerListType,
  ids: number[],
) {
  return parse(
    await call(token, listType, "PUT", "/sync", JSON.stringify(ids)),
  );
}
