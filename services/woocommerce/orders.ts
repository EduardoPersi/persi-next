import type { CheckoutTransferItem } from "@/lib/commerce/checkoutTransfer";
import type { CheckoutStoreAddress } from "@/types/checkout";
import { OPTIN_WHATSAPP_META, optinParaMeta, SESSAO_META } from "../../lib/painel/optin.ts";
import { metasDaPrevisao, type PrevisaoCongelada } from "../../lib/painel/previsaoEntrega.ts";
import { rastreiosDoPedido } from "../../lib/rastreio/melhorEnvio.ts";
import { WooCommerceRestError } from "./restError.ts";

export { WooCommerceRestError };

export type PaymentProvider = "inter" | "pagbank" | "mercadopago";

export type PersiPaymentMethod =
  | "inter_pix"
  | "inter_boleto"
  | "mercadopago_card"
  | "pagbank_apple_pay"
  | "pagbank_google_pay";

export interface WooCommerceOrder {
  id: number;
  status: string;
  total: string;
  currency: string;
  paymentMethod: string;
  billingEmail: string;
  /** Nome do cliente, para o lead de "pedido pendente" no painel. */
  billingName: string;
  /** Para o aviso de pedido pelo WhatsApp (lib/painel/whatsapp.ts). */
  billingPhone: string;
  metaData: Record<string, string>;
  /**
   * Códigos de rastreio do Melhor Envio gravados pelo plugin no pedido (meta
   * `_melhor_envio_tracking_codes`, que é uma LISTA e por isso não cabe em
   * `metaData`, que só guarda texto). Ver lib/painel/rastreio.ts.
   */
  rastreios?: string[];
  /**
   * Para onde e o que entregar, e por qual frete (fase 7 do painel: o pedido
   * pago de entrega da loja vira entrega na fila do motorista). Opcional:
   * pedidos montados à mão em testes e respostas antigas não trazem.
   */
  entrega?: DadosDaEntrega;
}

export interface EnderecoDaEntrega {
  destinatario?: string;
  cep?: string;
  rua?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

export interface ItemDaEntrega {
  sku?: string;
  nome: string;
  quantidade: number;
  preco_centavos?: number;
}

export interface DadosDaEntrega {
  endereco: EnderecoDaEntrega | null;
  itens: ItemDaEntrega[];
  /** A linha de frete escolhida no checkout (`shipping_lines[0]`). */
  frete: { metodoId: string; metodo: string; centavos?: number } | null;
}

interface WooAddressApi {
  first_name?: string;
  last_name?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  // Campos do plugin "Brazilian Market on WooCommerce", quando instalado.
  number?: string;
  neighborhood?: string;
}

interface WooCommerceOrderApiResponse {
  id: number;
  status: string;
  total: string;
  currency: string;
  payment_method?: string;
  billing?: { email?: string; phone?: string; first_name?: string; last_name?: string } & WooAddressApi;
  shipping?: WooAddressApi;
  line_items?: Array<{ name?: string; quantity?: number; sku?: string; total?: string }>;
  shipping_lines?: Array<{ method_id?: string; method_title?: string; total?: string }>;
  meta_data?: { key: string; value: unknown }[];
}

const IDEMPOTENCY_KEY_META = "_persi_idempotency_key";
const PAYMENT_PROVIDER_META = "_persi_payment_provider";
const PAYMENT_REFERENCE_META = "_persi_payment_reference";
// Só preenchidos para cobranças de cartão (PagBank) — a resposta de
// criação da cobrança já traz bandeira/final/parcelas, então gravamos aqui
// para a tela de confirmação não precisar reconsultar o provedor de novo.
const PAYMENT_CARD_BRAND_META = "_persi_payment_card_brand";
const PAYMENT_CARD_LAST_DIGITS_META = "_persi_payment_card_last_digits";
const PAYMENT_INSTALLMENTS_META = "_persi_payment_installments";
// Guarda o Cart-Token (JWT do WooCommerce Store API, httpOnly) ativo no
// momento em que o pedido foi criado — é o "segredo de posse" usado pela
// rota de status para confirmar que quem está consultando é quem fez o
// checkout, sem precisar de um token novo gerenciado pelo client
// (ver services/payments/statusAuthorization.ts).
const CHECKOUT_OWNER_TOKEN_META = "_persi_checkout_owner_token";
// Origem da compra (UTM, gclid, primeiro/último toque), em JSON. Gravada na
// criação do pedido a partir dos cookies de rastreio e reenviada ao painel
// quando o pedido muda de situação (lib/painel/pedido.ts). É só um meta do
// pedido: aditivo, sem migração, e removível sem afetar nada (ver LEIA-ME 3B).
export const ORDER_ORIGIN_META = "_persi_origem";

function toMetaRecord(
  metaData: WooCommerceOrderApiResponse["meta_data"],
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const entry of metaData ?? []) {
    if (typeof entry.value === "string") record[entry.key] = entry.value;
  }
  return record;
}

const limpo = (valor: unknown): string | undefined => {
  const texto = typeof valor === "string" ? valor.trim() : "";
  return texto || undefined;
};
const emCentavos = (valor: unknown): number | undefined => {
  const numero = Math.round(Number(valor) * 100);
  return Number.isFinite(numero) && numero >= 0 ? numero : undefined;
};

/**
 * O endereço de ENTREGA (o de cobrança só quando o de entrega veio vazio), com
 * número e bairro dos campos do Brazilian Market — no endereço ou nos metas.
 */
function enderecoDaEntrega(
  response: WooCommerceOrderApiResponse,
  meta: Record<string, string>,
): EnderecoDaEntrega | null {
  const usarEntrega = Boolean(limpo(response.shipping?.address_1) || limpo(response.shipping?.postcode));
  const a = (usarEntrega ? response.shipping : response.billing) ?? {};
  const prefixo = usarEntrega ? "_shipping" : "_billing";
  const endereco: EnderecoDaEntrega = {
    destinatario: [a.first_name, a.last_name].map(limpo).filter(Boolean).join(" ") || undefined,
    cep: limpo(a.postcode),
    rua: limpo(a.address_1),
    numero: limpo(a.number) ?? limpo(meta[`${prefixo}_number`]),
    complemento: limpo(a.address_2),
    bairro: limpo(a.neighborhood) ?? limpo(meta[`${prefixo}_neighborhood`]),
    cidade: limpo(a.city),
    uf: limpo(a.state),
  };
  return endereco.rua || endereco.cep ? endereco : null;
}

function dadosDaEntrega(
  response: WooCommerceOrderApiResponse,
  meta: Record<string, string>,
): DadosDaEntrega {
  const linha = response.shipping_lines?.[0];
  return {
    endereco: enderecoDaEntrega(response, meta),
    itens: (response.line_items ?? [])
      .map((item) => {
        const quantidade = Number(item.quantity) || 0;
        const total = emCentavos(item.total);
        return {
          nome: limpo(item.name) ?? "",
          quantidade,
          sku: limpo(item.sku),
          preco_centavos: total !== undefined && quantidade > 0 ? Math.round(total / quantidade) : undefined,
        };
      })
      .filter((item) => item.nome && item.quantidade > 0),
    frete: linha?.method_id
      ? { metodoId: linha.method_id, metodo: limpo(linha.method_title) ?? linha.method_id, centavos: emCentavos(linha.total) }
      : null,
  };
}

function toOrder(response: WooCommerceOrderApiResponse): WooCommerceOrder {
  const metaData = toMetaRecord(response.meta_data);
  return {
    id: response.id,
    status: response.status,
    total: response.total,
    currency: response.currency,
    paymentMethod: response.payment_method ?? "",
    billingEmail: response.billing?.email ?? "",
    billingName: [response.billing?.first_name, response.billing?.last_name]
      .map((parte) => parte?.trim())
      .filter(Boolean)
      .join(" "),
    billingPhone: response.billing?.phone ?? "",
    metaData,
    rastreios: rastreiosDoPedido(response.meta_data),
    entrega: dadosDaEntrega(response, metaData),
  };
}

/**
 * O pedido a partir do corpo de um webhook do WooCommerce (`order.updated`).
 * É o mesmo formato da REST API; o corpo é confiável porque chega assinado
 * (ver app/api/webhooks/woocommerce/pedido/route.ts).
 */
export function orderFromWebhookPayload(payload: unknown): WooCommerceOrder | null {
  if (!payload || typeof payload !== "object") return null;
  const corpo = payload as WooCommerceOrderApiResponse;
  if (!Number.isInteger(corpo.id) || corpo.id <= 0 || typeof corpo.status !== "string") return null;
  return toOrder({ ...corpo, total: String(corpo.total ?? ""), currency: String(corpo.currency ?? "BRL") });
}

// Único ponto de leitura do meta de posse do pedido — mantém a chave de
// meta_data como detalhe interno deste módulo.
export function getCheckoutOwnerToken(order: WooCommerceOrder): string {
  return order.metaData[CHECKOUT_OWNER_TOKEN_META] ?? "";
}

export interface OrderCardPaymentDetails {
  brand?: string;
  lastDigits?: string;
  installments?: number;
}

// Único ponto de leitura dos metas de cartão — mesmo padrão de
// getCheckoutOwnerToken acima. Pedidos Pix/Boleto simplesmente não têm
// esses metas gravados, então tudo volta undefined.
export function getOrderCardPaymentDetails(order: WooCommerceOrder): OrderCardPaymentDetails {
  const installmentsRaw = order.metaData[PAYMENT_INSTALLMENTS_META];
  return {
    brand: order.metaData[PAYMENT_CARD_BRAND_META] || undefined,
    lastDigits: order.metaData[PAYMENT_CARD_LAST_DIGITS_META] || undefined,
    installments: installmentsRaw ? Number(installmentsRaw) : undefined,
  };
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
  couponCodes?: string[];
  // `sessao` (hash do token do carrinho) e a escolha de WhatsApp do cliente:
  // só metadados, lib/painel/optin.ts. Opcionais: sem eles o pedido nasce como antes.
  sessao?: string;
  whatsappOptIn?: boolean;
  // Origem da compra já serializada (lib/tracking/servidor.ts). Opcional: sem
  // cookies de rastreio o pedido nasce exatamente como antes.
  origin?: string;
  // Previsão de entrega congelada (lib/painel/previsaoEntrega.ts): a data que o
  // checkout mostrou ao cliente. Gravada em metas do pedido para os avisos de
  // pago e cancelado repetirem a MESMA data. Opcional: sem ela (chave
  // PAINEL_ENVIAR_PREVISAO_ENTREGA desligada) o pedido nasce como antes.
  deliveryForecast?: PrevisaoCongelada;
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
    : input.paymentMethod === "mercadopago_card"
      ? "mercadopago"
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
    ...(input.couponCodes?.length
      ? { coupon_lines: input.couponCodes.map((code) => ({ code })) }
      : {}),
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
      ...(input.origin ? [{ key: ORDER_ORIGIN_META, value: input.origin }] : []),
      ...(input.sessao ? [{ key: SESSAO_META, value: input.sessao }] : []),
      ...(input.whatsappOptIn !== undefined
        ? [{ key: OPTIN_WHATSAPP_META, value: optinParaMeta(input.whatsappOptIn) }]
        : []),
      ...metasDaPrevisao(input.deliveryForecast),
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
  reference: {
    provider: PaymentProvider;
    externalId: string;
    cardBrand?: string;
    cardLastDigits?: string;
    installments?: number;
  },
  put: WooPutFn = defaultPut,
): Promise<WooCommerceOrder> {
  const response = await put<WooCommerceOrderApiResponse>(`orders/${orderId}`, {
    meta_data: [
      { key: PAYMENT_PROVIDER_META, value: reference.provider },
      { key: PAYMENT_REFERENCE_META, value: reference.externalId },
      ...(reference.cardBrand ? [{ key: PAYMENT_CARD_BRAND_META, value: reference.cardBrand }] : []),
      ...(reference.cardLastDigits
        ? [{ key: PAYMENT_CARD_LAST_DIGITS_META, value: reference.cardLastDigits }]
        : []),
      ...(reference.installments
        ? [{ key: PAYMENT_INSTALLMENTS_META, value: String(reference.installments) }]
        : []),
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

// "Este pedido já estava pago por esta cobrança?" Fonte única da resposta:
// markOrderAsPaid a usa para não reescrever o pedido, e a conciliação a usa
// para só avisar o painel/cliente quando o pedido MUDOU para pago.
export function isOrderAlreadyPaidFor(order: WooCommerceOrder, externalId: string): boolean {
  return (
    PAID_ORDER_STATUSES.has(order.status) &&
    order.metaData[PAYMENT_REFERENCE_META] === externalId
  );
}

export async function markOrderAsPaid(
  order: WooCommerceOrder,
  reference: { provider: PaymentProvider; externalId: string },
  put: WooPutFn = defaultPut,
): Promise<WooCommerceOrder> {
  if (isOrderAlreadyPaidFor(order, reference.externalId)) return order;

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

export function isOrderAlreadyFailed(order: WooCommerceOrder): boolean {
  return FAILED_ORDER_STATUSES.has(order.status);
}

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

// As cobranças (Pix/boleto) já mandadas ao cliente pelo WhatsApp, como
// "forma:momento" separados por vírgula (ex.: "pix:agora,pix:lembrete"). É a
// trava do lado do site para o cron não pedir a mesma mensagem a cada passada;
// o painel tem a sua (ver lib/painel/cobranca.ts). Só um meta: aditivo.
export const COBRANCA_WHATSAPP_META = "_persi_cobranca_whatsapp";

export async function marcarCobrancaNoPedido(
  orderId: number,
  valor: string,
  put: WooPutFn = defaultPut,
): Promise<void> {
  await put(`orders/${orderId}`, { meta_data: [{ key: COBRANCA_WHATSAPP_META, value: valor }] });
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
  // Para o evento `purchase` do GA4 usar o mesmo item_id de add_to_cart/view_item
  // (SKU, senão id do produto). Opcionais: pedidos antigos podem não trazer.
  productId?: number;
  sku?: string;
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
    product_id?: number;
    sku?: string;
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
      productId: item.product_id,
      sku: item.sku || undefined,
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
