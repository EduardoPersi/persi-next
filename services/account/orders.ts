import {
  parseOrderResponse,
  parseOrdersResponse,
  type AccountOrderDetail,
  type AccountOrderStatus,
  type AccountOrdersResponse,
} from "../../lib/account/orders.ts";
import {
  AccountServiceError,
  getAccountClientConfig,
  requestAccountEndpoint,
  type AccountClientConfig,
} from "./client.ts";

type Options = { config?: AccountClientConfig; fetchImplementation?: typeof fetch };

export async function getAccountOrders(
  sessionToken: string,
  input: { page: number; perPage: number; status?: AccountOrderStatus | null },
  options: Options = {},
): Promise<AccountOrdersResponse> {
  const query = new URLSearchParams({ page: String(input.page), per_page: String(input.perPage) });
  if (input.status) query.set("status", input.status);
  const result = await requestAccountEndpoint({
    config: options.config ?? getAccountClientConfig(), method: "GET", route: "/orders",
    query: query.toString(), rawBody: "", sessionToken, fetchImplementation: options.fetchImplementation,
  });
  if (result.status < 200 || result.status >= 300) throw new AccountServiceError([400, 401, 503].includes(result.status) ? result.status : 502, "Orders unavailable");
  try { return parseOrdersResponse(result.body); } catch { throw new AccountServiceError(502, "Invalid orders response"); }
}

export async function getAccountOrder(
  sessionToken: string,
  orderId: number,
  options: Options = {},
): Promise<AccountOrderDetail> {
  const result = await requestAccountEndpoint({
    config: options.config ?? getAccountClientConfig(), method: "GET", route: `/orders/${orderId}`,
    rawBody: "", sessionToken, fetchImplementation: options.fetchImplementation,
  });
  if (result.status < 200 || result.status >= 300) throw new AccountServiceError([401, 404, 503].includes(result.status) ? result.status : 502, "Order unavailable");
  try { return parseOrderResponse(result.body); } catch { throw new AccountServiceError(502, "Invalid order response"); }
}
