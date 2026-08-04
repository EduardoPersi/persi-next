import type { CheckoutTransferItem } from "@/lib/commerce/checkoutTransfer";
import type { CheckoutStoreAddress } from "@/types/checkout";
import { WooCommerceRestError } from "./restError.ts";

export { WooCommerceRestError };

export type PaymentProvider = "inter" | "pagbank";

export type PersiPaymentMethod =
  | "inter_pix"
  | "inter_boleto"
  | "pagbank_card"
  | "pagbank_apple_pay"
  | "pagbank_google_pay";

export interface WooCommerceOrder {
  id: number;
  status: string;
  total: string;
  currency: string;
  paymentMethod: string;
  billingEmail: string;
  metaData: Record<string, string>;
}

interface WooCommerceOrderApiResponse {
  id: number;
  status: string;
  total: string;
  currency: string;
  payment_method?: string;
  billing?: { email?: string };
  meta_data?: { key: string; value: unknown }[];
}

const IDEMPOTENCY_KEY_META = "_persi_idempotency_key";
const PAYMENT_PROVIDER_META = "_persi_payment_provider";
const PAYMENT_REFERENCE_META = "_persi_payment_reference";
// Guarda o Cart-Token (JWT do WooCommerce Store API, httpOnly) ativo no
// momento em que o pedido foi criado — é o "segredo de posse" usado pela
// rota de status para confirmar que quem está consultando é quem fez o
// checkout, sem precisar de um token novo gerenciado pelo client
// (ver services/payments/statusAuthorization.ts).
const CHECKOUT_OWNER_TOKEN_META = "_persi_checkout_owner_token";

function toMetaRecord(
  metaData: WooCommerceOrderApiResponse["meta_data"],
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const entry of metaData ?? []) {
    if (typeof entry.value === "string") record[entry.key] = entry.value;
  }
  return record;
}

function toOrder(response: WooCommerceOrderApiResponse): WooCommerceOrder {
  return {
    id: response.id,
    status: response.status,
    total: response.total,
    currency: response.currency,
    paymentMethod: response.payment_method ?? "",
    billingEmail: response.billing?.email ?? "",
    metaData: toMetaRecord(response.meta_data),
  };
}

// Único ponto de leitura do meta de posse do pedido — mantém a chave de
// meta_data como detalhe interno deste módulo.
export function getCheckoutOwnerToken(order: WooCommerceOrder): string {
  return order.metaData[CHECKOUT_OWNER_TOKEN_META] ?? "";
}

type WooPostFn = <T>(endpoint: string, body: unknown) => Promise<T>;
type WooPutFn = <T>(endpoint: string, body: unknown) => Promise<T>;
type WooGetListFn = <T>(endpoint: string, query: Record<string, string>) => Promise<T[]>;

// Import dinâmico: `restClient.ts` importa "server-only" (as credenciais do
// WooCommerce nunca podem rodar fora de um contexto de servidor) e por isso
// não pode ser carregado estaticamente por quem só quer usar as funções
// puras deste arquivo (ex.: testes). Só é resolvido quando nenhuma
// dependência é injetada pelo chamador.
const defaultPost: WooPostFn = async (endpoint, body) => {
  const { restApiPost } = await import("./restClient.ts");
  return restApiPost(endpoint, body);
};
const defaultPut: WooPutFn = async (endpoint, body) => {
  const { restApiPut } = await import("./restClient.ts");
  return restApiPut(endpoint, body);
};
const defaultGetList: WooGetListFn = async (endpoint, query) => {
  const { restApiGetWithMeta } = await import("./restClient.ts");
  const result = await restApiGetWithMeta<unknown>(endpoint, { query, revalidate: 0 });
  return result.data as never;
};

export interface CreatePendingOrderInput {
  idempotencyKey: string;
  items: CheckoutTransferItem[];
  billingAddress: CheckoutStoreAddress;
  shippingAddress: CheckoutStoreAddress;
  paymentMethod: PersiPaymentMethod;
  customerNote?: string;
  ownerToken: string;
  // Desconto por forma de pagamento (Pix/Boleto): vira uma fee_line negativa
  // no pedido do WooCommerce, para que o total do pedido já saia com o
  // desconto aplicado — é esse total (não o do carrinho) que é cobrado no
  // Banco Inter/PagBank, então os dois nunca podem divergir.
  discountFee?: { name: string; amount: number };
}

function toWooAddress(address: CheckoutStoreAddress) {
  return {
    first_name: address.firstName,
    last_name: address.lastName,
    company: address.company ?? "",
    address_1: address.address1,
    address_2: address.address2 ?? "",
    city: address.city,
    state: address.state,
    postcode: address.postcode,
    country: address.country,
    email: address.email ?? "",
    phone: address.phone ?? "",
  };
}

export async function createPendingOrder(
  input: CreatePendingOrderInput,
  post: WooPostFn = defaultPost,
): Promise<WooCommerceOrder> {
  if (input.items.length < 1) {
    throw new WooCommerceRestError("O carrinho não pode estar vazio.", 422);
  }

  const provider: PaymentProvider = input.paymentMethod.startsWith("inter_")
    ? "inter"
    : "pagbank";

  const response = await post<WooCommerceOrderApiResponse>("orders", {
    status: "pending",
    set_paid: false,
    billing: toWooAddress(input.billingAddress),
    shipping: toWooAddress(input.shippingAddress),
    payment_method: input.paymentMethod,
    customer_note: input.customerNote ?? "",
    line_items: input.items.map((item) => ({
      product_id: item.productId,
      ...(item.variationId > 0 ? { variation_id: item.variationId } : {}),
      quantity: item.quantity,
    })),
    ...(input.discountFee && input.discountFee.amount > 0
      ? {
          fee_lines: [
            {
              name: input.discountFee.name,
              total: (-input.discountFee.amount).toFixed(2),
            },
          ],
        }
      : {}),
    meta_data: [
      { key: IDEMPOTENCY_KEY_META, value: input.idempotencyKey },
      { key: PAYMENT_PROVIDER_META, value: provider },
      { key: CHECKOUT_OWNER_TOKEN_META, value: input.ownerToken },
    ],
  });

  return toOrder(response);
}

export async function findOrderByIdempotencyKey(
  idempotencyKey: string,
  getList: WooGetListFn = defaultGetList,
): Promise<WooCommerceOrder | null> {
  const orders = await getList<WooCommerceOrderApiResponse>("orders", {
    meta_key: IDEMPOTENCY_KEY_META,
    meta_value: idempotencyKey,
  });
  const [order] = orders;
  return order ? toOrder(order) : null;
}

export async function attachPaymentReference(
  orderId: number,
  reference: { provider: PaymentProvider; externalId: string },
  put: WooPutFn = defaultPut,
): Promise<WooCommerceOrder> {
  const response = await put<WooCommerceOrderApiResponse>(`orders/${orderId}`, {
    meta_data: [
      { key: PAYMENT_PROVIDER_META, value: reference.provider },
      { key: PAYMENT_REFERENCE_META, value: reference.externalId },
    ],
  });

  return toOrder(response);
}

export async function findOrderByPaymentReference(
  provider: PaymentProvider,
  externalId: string,
  getList: WooGetListFn = defaultGetList,
): Promise<WooCommerceOrder | null> {
  const orders = await getList<WooCommerceOrderApiResponse>("orders", {
    meta_key: PAYMENT_REFERENCE_META,
    meta_value: externalId,
  });
  const [order] = orders.filter(
    (candidate) => toMetaRecord(candidate.meta_data)[PAYMENT_PROVIDER_META] === provider,
  );
  return order ? toOrder(order) : null;
}

const PAID_ORDER_STATUSES = new Set(["processing", "completed"]);

export async function markOrderAsPaid(
  order: WooCommerceOrder,
  reference: { provider: PaymentProvider; externalId: string },
  put: WooPutFn = defaultPut,
): Promise<WooCommerceOrder> {
  const alreadyPaidForThisReference =
    PAID_ORDER_STATUSES.has(order.status) &&
    order.metaData[PAYMENT_REFERENCE_META] === reference.externalId;

  if (alreadyPaidForThisReference) return order;

  const response = await put<WooCommerceOrderApiResponse>(`orders/${order.id}`, {
    status: "processing",
    set_paid: true,
    meta_data: [
      { key: PAYMENT_PROVIDER_META, value: reference.provider },
      { key: PAYMENT_REFERENCE_META, value: reference.externalId },
    ],
  });

  return toOrder(response);
}

const FAILED_ORDER_STATUSES = new Set(["failed", "cancelled"]);

export async function markOrderAsFailed(
  order: WooCommerceOrder,
  status: "failed" | "cancelled",
  put: WooPutFn = defaultPut,
): Promise<WooCommerceOrder> {
  if (FAILED_ORDER_STATUSES.has(order.status)) return order;

  const response = await put<WooCommerceOrderApiResponse>(`orders/${order.id}`, {
    status,
  });

  return toOrder(response);
}

// Usado pela varredura de expiração (app/api/cron/expire-pending-payments) —
// só considera pedidos que já têm uma cobrança criada no provedor (sem
// referência, o pedido ainda pode estar "em voo" na primeira requisição, não
// é uma cobrança abandonada).
export async function findPendingOrdersWithPaymentReference(
  getList: WooGetListFn = defaultGetList,
): Promise<WooCommerceOrder[]> {
  const orders = await getList<WooCommerceOrderApiResponse>("orders", {
    status: "pending",
    meta_key: PAYMENT_REFERENCE_META,
  });
  return orders
    .map(toOrder)
    .filter((order) => order.metaData[PAYMENT_REFERENCE_META]);
}
