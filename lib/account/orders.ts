export const ACCOUNT_ORDER_STATUSES = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
] as const;

export type AccountOrderStatus = (typeof ACCOUNT_ORDER_STATUSES)[number];
export type Money = { value: string; currency: string; formatted: string };
export type OrderAddress = {
  firstName: string; lastName: string; company: string; address1: string;
  address2: string; city: string; state: string; postcode: string; country: string;
};
export type AccountOrderSummary = {
  id: number; number: string; dateCreated: string; status: AccountOrderStatus;
  statusLabel: string; total: Money; itemCount: number; paymentMethod: string;
  paymentMethodTitle: string; shippingMethodTitle: string; canOpen: boolean;
};
export type AccountOrdersResponse = {
  orders: AccountOrderSummary[];
  pagination: { page: number; perPage: number; totalItems: number; totalPages: number };
};
export type AccountOrderDetail = Omit<AccountOrderSummary, "total" | "itemCount" | "paymentMethod" | "paymentMethodTitle" | "shippingMethodTitle" | "canOpen"> & {
  items: Array<{ id: number; productId: number; variationId: number; name: string; quantity: number; subtotal: Money; total: Money; image: { src: string; alt: string } }>;
  totals: { subtotal: Money; discount: Money; shipping: Money; fees: Money; tax: Money; total: Money };
  payment: { method: string; title: string };
  shipping: { methodTitle: string; address: OrderAddress };
  billing: OrderAddress & { email: string; phone: string };
  customerNote: string;
};

export class AccountOrderValidationError extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountOrderValidationError();
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new AccountOrderValidationError();
  return value;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new AccountOrderValidationError();
  return Number(value);
}
function money(value: unknown): Money {
  const item = record(value);
  return { value: string(item.value), currency: string(item.currency), formatted: string(item.formatted) };
}
function status(value: unknown): AccountOrderStatus {
  if (typeof value !== "string" || !ACCOUNT_ORDER_STATUSES.includes(value as AccountOrderStatus)) throw new AccountOrderValidationError();
  return value as AccountOrderStatus;
}
function address(value: unknown): OrderAddress {
  const item = record(value);
  return {
    firstName: string(item.firstName), lastName: string(item.lastName), company: string(item.company),
    address1: string(item.address1), address2: string(item.address2), city: string(item.city),
    state: string(item.state), postcode: string(item.postcode), country: string(item.country),
  };
}
function summary(value: unknown): AccountOrderSummary {
  const item = record(value);
  return {
    id: integer(item.id), number: string(item.number), dateCreated: string(item.dateCreated),
    status: status(item.status), statusLabel: string(item.statusLabel), total: money(item.total),
    itemCount: integer(item.itemCount), paymentMethod: string(item.paymentMethod),
    paymentMethodTitle: string(item.paymentMethodTitle), shippingMethodTitle: string(item.shippingMethodTitle),
    canOpen: item.canOpen === true,
  };
}

export function parseOrdersQuery(input: URLSearchParams) {
  for (const key of input.keys()) if (!["page", "per_page", "status"].includes(key)) throw new AccountOrderValidationError();
  const parse = (name: string, fallback: number, max: number) => {
    const raw = input.get(name);
    if (raw === null) return fallback;
    if (!/^[0-9]+$/.test(raw)) throw new AccountOrderValidationError();
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new AccountOrderValidationError();
    return value;
  };
  const statusValue = input.get("status");
  if (statusValue && !ACCOUNT_ORDER_STATUSES.includes(statusValue as AccountOrderStatus)) throw new AccountOrderValidationError();
  return { page: parse("page", 1, Number.MAX_SAFE_INTEGER), perPage: parse("per_page", 10, 20), status: statusValue as AccountOrderStatus | null };
}

export function parseOrderId(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new AccountOrderValidationError();
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new AccountOrderValidationError();
  return id;
}

export function parseOrdersResponse(value: unknown): AccountOrdersResponse {
  const root = record(value); const pagination = record(root.pagination);
  if (!Array.isArray(root.orders)) throw new AccountOrderValidationError();
  return {
    orders: root.orders.map(summary),
    pagination: { page: integer(pagination.page), perPage: integer(pagination.perPage), totalItems: integer(pagination.totalItems), totalPages: integer(pagination.totalPages) },
  };
}

export function parseOrderResponse(value: unknown): AccountOrderDetail {
  const root = record(value); const item = record(root.order); const totals = record(item.totals);
  const payment = record(item.payment); const shipping = record(item.shipping); const billing = record(item.billing);
  if (!Array.isArray(item.items)) throw new AccountOrderValidationError();
  return {
    id: integer(item.id), number: string(item.number), dateCreated: string(item.dateCreated),
    status: status(item.status), statusLabel: string(item.statusLabel),
    items: item.items.map((raw) => { const line = record(raw); const image = record(line.image); return {
      id: integer(line.id), productId: integer(line.productId), variationId: integer(line.variationId),
      name: string(line.name), quantity: integer(line.quantity), subtotal: money(line.subtotal),
      total: money(line.total), image: { src: string(image.src), alt: string(image.alt) },
    }; }),
    totals: { subtotal: money(totals.subtotal), discount: money(totals.discount), shipping: money(totals.shipping), fees: money(totals.fees), tax: money(totals.tax), total: money(totals.total) },
    payment: { method: string(payment.method), title: string(payment.title) },
    shipping: { methodTitle: string(shipping.methodTitle), address: address(shipping.address) },
    billing: { ...address(billing), email: string(billing.email), phone: string(billing.phone) },
    customerNote: string(item.customerNote),
  };
}
