import type {
  ConnectedAccount,
  CustomerAddressType,
  CustomerWorkspaceAddress,
  CustomerWorkspaceProfile,
  CustomerWorkspaceSummary,
  StockNotificationSubscription,
} from "@/lib/customer-workspace/types";
import {
  AccountServiceError,
  getAccountClientConfig,
  requestAccountEndpoint,
} from "./client";

type WorkspaceRoute =
  | "/workspace"
  | "/profile"
  | "/addresses"
  | `/addresses/${CustomerAddressType}`
  | `/addresses/${CustomerAddressType}/primary`
  | "/connected-accounts"
  | "/stock-notifications"
  | `/stock-notifications/${number}`;

export async function requestCustomerWorkspace(
  token: string,
  method: "GET" | "PUT" | "DELETE",
  route: WorkspaceRoute,
  rawBody = "",
): Promise<unknown> {
  const result = await requestAccountEndpoint({
    config: getAccountClientConfig(), method, route, rawBody, sessionToken: token,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new AccountServiceError(
      [400, 401, 404, 429, 503].includes(result.status) ? result.status : 502,
      typeof (result.body as { message?: unknown } | null)?.message === "string"
        ? String((result.body as { message: string }).message)
        : "Customer workspace unavailable",
    );
  }
  return result.body;
}

export const getCustomerWorkspaceSummary = (token: string) =>
  requestCustomerWorkspace(token, "GET", "/workspace") as Promise<CustomerWorkspaceSummary>;
export const getCustomerWorkspaceProfile = (token: string) =>
  requestCustomerWorkspace(token, "GET", "/profile") as Promise<CustomerWorkspaceProfile>;
export const getCustomerWorkspaceAddresses = (token: string) =>
  requestCustomerWorkspace(token, "GET", "/addresses") as Promise<CustomerWorkspaceAddress[]>;
export const getConnectedAccounts = (token: string) =>
  requestCustomerWorkspace(token, "GET", "/connected-accounts") as Promise<ConnectedAccount[]>;
export const getStockNotificationSubscriptions = (token: string) =>
  requestCustomerWorkspace(token, "GET", "/stock-notifications") as Promise<StockNotificationSubscription[]>;
