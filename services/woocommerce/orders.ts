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
type WooGetFn = <T>(endpoint: string) => Promise<T>;

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
const defaultGet: WooGetFn = async (endpoint) => {
  const { restApiGetWithMeta } = await import("./restClient.ts");
  const result = await restApiGetWithMeta<unknown>(endpoint, { revalidate: 0 });
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
  // ID do usuário WordPress do cliente logado. Sem isso o pedido fica
  // "convidado" (sem dono) e não aparece em "Meus pedidos", mesmo com o
  // cliente autenticado — checkout exige login, então isso deveria sempre
  // vir preenchido na prática.
  customerId?: number;
  // Desconto por forma de pagamento (Pix/Boleto): vira uma fee_line negativa
  // no pedido do WooCommerce, para que o total do pedido já saia com o
  // desconto aplicado — é esse total (não o do carrinho) que é cobrado no
  // Banco Inter/PagBank, então os dois nunca podem divergir.
  discountFee?: { name: string; amount: number };
  // Sem isso o pedido nunca soube que a compra tinha frete — o valor cobrado
  // no Inter/PagBank sempre incluiu o frete (via cart.totals.price), mas o
  // registro do pedido no WooCommerce ficava sem shipping_lines, então
  // relatórios e a tela de confirmação não conseguiam mostrar a entrega.
  shippingLine?: { name: string; amount: number; methodId: string };
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
    ...(input.customerId ? { customer_id: input.customerId } : {}),
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
    ...(input.shippingLine
      ? {
          shipping_lines: [
            {
              method_id: input.shippingLine.methodId,
              method_title: input.shippingLine.name,
              total: input.shippingLine.amount.toFixed(2),
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

export async function getOrderById(
  orderId: number,
  get: WooGetFn = defaultGet,
): Promise<WooCommerceOrder> {
  const response = await get<WooCommerceOrderApiResponse>(`orders/${orderId}`);
  return toOrder(response);
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

// Reaproveitado pela tela de confirmação para pedidos criados diretamente
// pelo checkout nativo do WooCommerce (não passam por markOrderAsPaid/
// markOrderAsFailed, então o status já vem definido pelo próprio gateway).
export function categorizeOrderStatus(
  status: string,
): "paid" | "pending" | "failed" {
  if (PAID_ORDER_STATUSES.has(status)) return "paid";
  if (FAILED_ORDER_STATUSES.has(status)) return "failed";
  return "pending";
}

// Usado pela varredura de expiração (app/api/cron/expire-pending-payments) —
// só considera pedidos que já têm uma cobrança criada no provedor (sem
// referência, o pedido ainda pode estar "em voo" na primeira requisição, não
// é uma cobrança abandonada).
//
// Inclui "on-hold" além de "pending": um gateway antigo do WooCommerce ainda
// ativo neste site altera o status de pedidos recém-criados para "on-hold"
// antes de a reconciliação rodar — sem isso, esses pedidos ficam invisíveis
// para sempre a esta varredura mesmo já pagos. Ver docs/25 e histórico do
// incidente do pedido #30855 (2026-08-04).
const RECONCILIABLE_ORDER_STATUSES = ["pending", "on-hold"] as const;

export async function findPendingOrdersWithPaymentReference(
  getList: WooGetListFn = defaultGetList,
): Promise<WooCommerceOrder[]> {
  const ordersByStatus = await Promise.all(
    RECONCILIABLE_ORDER_STATUSES.map((status) =>
      getList<WooCommerceOrderApiResponse>("orders", {
        status,
        meta_key: PAYMENT_REFERENCE_META,
      }),
    ),
  );

  const seenIds = new Set<number>();
  const orders: WooCommerceOrder[] = [];
  for (const order of ordersByStatus.flat().map(toOrder)) {
    if (!order.metaData[PAYMENT_REFERENCE_META] || seenIds.has(order.id)) continue;
    seenIds.add(order.id);
    orders.push(order);
  }
  return orders;
}

export interface OrderConfirmationItem {
  id: number;
  name: string;
  quantity: number;
  total: string;
  imageSrc?: string;
}

export interface OrderConfirmationDetails {
  id: number;
  currency: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  document: string;
  items: OrderConfirmationItem[];
  itemsSubtotal: string;
  shippingLabel: string;
  shippingTotal: string;
  discountLabel: string;
  discountTotal: string;
  total: string;
  // Só preenchido para pedidos do checkout nativo do WooCommerce (provider
  // "woocommerce") — Inter/PagBank continuam usando PAYMENT_METHOD_LABELS
  // fixo na página de confirmação, já que esses pedidos nunca tiveram um
  // gateway nativo configurado que gerasse este título.
  paymentMethodLabel: string;
}

interface WooCommerceOrderDetailsApiResponse {
  id: number;
  currency: string;
  total: string;
  payment_method_title?: string;
  billing?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    cpf?: string;
    cnpj?: string;
  };
  line_items?: Array<{
    id: number;
    name: string;
    quantity: number;
    total: string;
    image?: { src?: string };
  }>;
  shipping_lines?: Array<{ method_title: string; total: string }>;
  fee_lines?: Array<{ name: string; total: string }>;
}

function sumMoneyStrings(values: string[]): string {
  const sum = values.reduce((acc, value) => acc + (Number(value) || 0), 0);
  return sum.toFixed(2);
}

export async function getOrderConfirmationDetails(
  orderId: number,
  get: WooGetFn = defaultGet,
): Promise<OrderConfirmationDetails> {
  const response = await get<WooCommerceOrderDetailsApiResponse>(`orders/${orderId}`);
  const billing = response.billing ?? {};
  const items = response.line_items ?? [];
  const shipping = response.shipping_lines?.[0];
  // Só a fee_line negativa é um desconto — WooCommerce também usa fee_lines
  // para acréscimos (ex.: taxas), que aqui não existem, mas não custa ser
  // explícito em vez de assumir que toda fee_line é sempre um desconto.
  const discountFees = (response.fee_lines ?? []).filter(
    (fee) => (Number(fee.total) || 0) < 0,
  );

  return {
    id: response.id,
    currency: response.currency,
    firstName: billing.first_name ?? "",
    lastName: billing.last_name ?? "",
    email: billing.email ?? "",
    phone: billing.phone ?? "",
    document: billing.cpf || billing.cnpj || "",
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      total: item.total,
      imageSrc: item.image?.src,
    })),
    itemsSubtotal: sumMoneyStrings(items.map((item) => item.total)),
    shippingLabel: shipping?.method_title ?? "",
    shippingTotal: shipping?.total ?? "0.00",
    discountLabel: discountFees[0]?.name ?? "Desconto",
    discountTotal: sumMoneyStrings(discountFees.map((fee) => fee.total)).replace(/^-/, ""),
    total: response.total,
    paymentMethodLabel: response.payment_method_title ?? "",
  };
}
