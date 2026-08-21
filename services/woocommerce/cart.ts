import type {
  Cart,
  CartAddress,
  CartFee,
  CartItem,
  CartMoney,
  CartTaxLine,
  CheckoutShippingPackage,
  CheckoutShippingRate,
} from "@/types/cart";
import type {
  CheckoutCustomerPayload,
  CheckoutStoreAddress,
} from "@/types/checkout";
import { stripHtml } from "./mappers.ts";

const REQUEST_TIMEOUT_MS = 10_000;

interface WooMoneyFields {
  currency_code?: string;
  currency_symbol?: string;
  currency_minor_unit?: number;
}

interface WooCartImage {
  src?: string;
  alt?: string;
}

interface WooCartItem {
  key?: string;
  id?: number;
  name?: string;
  sku?: string;
  permalink?: string;
  variation?: Array<{ attribute?: string; value?: string }>;
  quantity?: number;
  quantity_limits?: {
    minimum?: number;
    maximum?: number;
    multiple_of?: number;
  };
  images?: WooCartImage[];
  prices?: WooMoneyFields & { price?: string };
  totals?: WooMoneyFields & {
    line_total?: string;
  };
}

interface WooCartCoupon {
  code?: string;
  discount_type?: string;
  totals?: WooMoneyFields & {
    total_discount?: string;
    total_discount_tax?: string;
  };
}

interface WooCartFee {
  key?: string;
  name?: string;
  totals?: WooMoneyFields & {
    total?: string;
    total_tax?: string;
  };
}

interface WooCartAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

interface WooShippingRate {
  rate_id?: string;
  name?: string;
  description?: string;
  delivery_time?: string;
  price?: string;
  selected?: boolean;
  method_id?: string;
  instance_id?: number | string;
  meta_data?: Array<{ key?: string; value?: string }>;
  currency_code?: string;
  currency_symbol?: string;
  currency_minor_unit?: number;
}

interface WooShippingPackage {
  package_id?: number | string;
  name?: string;
  destination?: WooCartAddress;
  shipping_rates?: WooShippingRate[];
}

interface WooCartTotals extends WooMoneyFields {
  total_items?: string;
  total_items_tax?: string;
  total_fees?: string;
  total_fees_tax?: string;
  total_discount?: string;
  total_discount_tax?: string;
  total_shipping?: string;
  total_shipping_tax?: string;
  total_price?: string;
  total_tax?: string;
  tax_lines?: Array<{
    name?: string;
    price?: string;
    rate?: string;
  }>;
}

interface WooCart {
  items?: WooCartItem[];
  coupons?: WooCartCoupon[];
  fees?: WooCartFee[];
  totals?: WooCartTotals;
  shipping_address?: WooCartAddress;
  billing_address?: WooCartAddress;
  needs_shipping?: boolean;
  has_calculated_shipping?: boolean;
  shipping_rates?: WooShippingPackage[];
  items_count?: number;
}

export interface CartServiceResponse {
  cart: Cart;
  cartToken?: string;
}

export interface AddCartItemInput {
  productId: number;
  quantity: number;
  variation?: Array<{ attribute: string; value: string }>;
}

export interface SelectShippingRateInput {
  packageId: number | string;
  rateId: string;
}

export class CartServiceError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(
    message: string,
    status = 502,
    code?: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "CartServiceError";
  }
}

function getCartUrl(endpoint = "cart"): URL {
  const wordpressUrl = process.env.WORDPRESS_URL;
  if (!wordpressUrl) {
    throw new CartServiceError(
      "A configuração do WooCommerce está incompleta.",
      503,
    );
  }
  return new URL(
    `/wp-json/wc/store/v1/${endpoint.replace(/^\/+/, "")}`,
    wordpressUrl,
  );
}

function getSlug(permalink: string | undefined) {
  if (!permalink) return undefined;
  try {
    return new URL(permalink).pathname.split("/").filter(Boolean).at(-1);
  } catch {
    return undefined;
  }
}

function getVariationLabel(attribute: string) {
  return stripHtml(
    attribute
      .replace(/^attribute_/, "")
      .replace(/^pa_/, "")
      .replace(/[-_]+/g, " "),
  ).replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

function validMinorValue(value: unknown): string {
  return typeof value === "string" && /^-?\d+$/.test(value) ? value : "0";
}

function mapMoney(
  value: unknown,
  fields: WooMoneyFields | undefined,
  fallback: WooMoneyFields,
): CartMoney {
  return {
    value: validMinorValue(value),
    currencyCode: fields?.currency_code ?? fallback.currency_code ?? "BRL",
    currencySymbol:
      fields?.currency_symbol ?? fallback.currency_symbol ?? "R$",
    currencyMinorUnit:
      fields?.currency_minor_unit ?? fallback.currency_minor_unit ?? 2,
  };
}

function minorToMajor(value: string | undefined, minorUnit: number) {
  return value && /^\d+$/.test(value)
    ? Number(value) / 10 ** minorUnit
    : 0;
}

function mapCartItem(
  item: WooCartItem,
  minorUnit: number,
  freeShippingIds: ReadonlySet<number> = new Set(),
  freeShippingSlugs: ReadonlySet<string> = new Set(),
): CartItem | null {
  if (
    typeof item.key !== "string" ||
    typeof item.id !== "number" ||
    typeof item.name !== "string" ||
    typeof item.quantity !== "number"
  ) {
    return null;
  }
  const image = item.images?.[0];
  const slug = getSlug(item.permalink);
  return {
    key: item.key,
    id: item.id,
    productId: item.id,
    variationId: item.variation?.length ? item.id : undefined,
    name: stripHtml(item.name),
    sku: item.sku ? stripHtml(item.sku) : undefined,
    permalink: item.permalink,
    slug,
    variation: (item.variation ?? []).flatMap((attribute) =>
      attribute.attribute && attribute.value
        ? [{
            attribute: attribute.attribute,
            label: getVariationLabel(attribute.attribute),
            value: stripHtml(attribute.value),
          }]
        : [],
    ),
    quantity: item.quantity,
    minQuantity: item.quantity_limits?.minimum ?? 1,
    maxQuantity:
      typeof item.quantity_limits?.maximum === "number"
        ? Math.min(999, item.quantity_limits.maximum)
        : 999,
    quantityStep: item.quantity_limits?.multiple_of ?? 1,
    image: image?.src
      ? { src: image.src, alt: stripHtml(image.alt || item.name) }
      : undefined,
    price: minorToMajor(item.prices?.price, minorUnit),
    total: minorToMajor(item.totals?.line_total, minorUnit),
    freeShipping:
      freeShippingIds.has(item.id) ||
      (typeof slug === "string" && freeShippingSlugs.has(slug)),
  };
}

function normalizeAddress(value: WooCartAddress | undefined): CartAddress | undefined {
  if (!value || typeof value !== "object") return undefined;
  return {
    firstName: value.first_name,
    lastName: value.last_name,
    company: value.company,
    address1: value.address_1,
    address2: value.address_2,
    city: value.city,
    state: value.state,
    postcode: value.postcode,
    country: value.country,
    email: value.email,
    phone: value.phone,
  };
}

function getDeliveryTime(rate: WooShippingRate): string | undefined {
  const direct = rate.delivery_time?.trim();
  if (direct) return stripHtml(direct);
  const metadata = rate.meta_data?.find(
    ({ key, value }) =>
      key === "_wc_smart_checkout_delivery_time" &&
      typeof value === "string" &&
      value.trim(),
  );
  return metadata?.value ? stripHtml(metadata.value.trim()) : undefined;
}

export function normalizeShippingPackages(
  value: unknown,
  fallbackMoney: WooMoneyFields = {},
): CheckoutShippingPackage[] {
  if (!Array.isArray(value)) return [];
  const packageIds = new Set<string>();
  return value.flatMap((rawPackage) => {
    if (!rawPackage || typeof rawPackage !== "object") return [];
    const source = rawPackage as WooShippingPackage;
    if (
      typeof source.package_id !== "number" &&
      typeof source.package_id !== "string"
    ) {
      return [];
    }
    const packageKey = String(source.package_id);
    if (packageIds.has(packageKey)) return [];
    packageIds.add(packageKey);
    const rateIds = new Set<string>();
    const rates: CheckoutShippingRate[] = (source.shipping_rates ?? []).flatMap(
      (rate) => {
        if (!rate || typeof rate.rate_id !== "string" || !rate.rate_id) return [];
        const uniqueKey = `${packageKey}:${rate.rate_id}`;
        if (rateIds.has(uniqueKey)) return [];
        rateIds.add(uniqueKey);
        return [{
          packageId: source.package_id as number | string,
          rateId: rate.rate_id,
          name: stripHtml(rate.name || rate.rate_id),
          description: rate.description
            ? stripHtml(rate.description)
            : undefined,
          deliveryTime: getDeliveryTime(rate),
          price: mapMoney(rate.price, rate, fallbackMoney),
          selected: rate.selected === true,
          methodId: rate.method_id,
          instanceId:
            rate.instance_id === undefined
              ? undefined
              : String(rate.instance_id),
          metaData: (rate.meta_data ?? []).flatMap(({ key, value }) =>
            typeof key === "string" && typeof value === "string"
              ? [{ key, value: stripHtml(value) }]
              : [],
          ),
        }];
      },
    );
    return [{
      packageId: source.package_id,
      name: source.name ? stripHtml(source.name) : undefined,
      destination: normalizeAddress(source.destination),
      rates,
    }];
  });
}

function normalizeFees(
  fees: WooCartFee[] | undefined,
  fallback: WooMoneyFields,
): CartFee[] {
  return (fees ?? []).flatMap((fee, index) =>
    fee && typeof fee.name === "string"
      ? [{
          key: fee.key ?? `${fee.name}-${index}`,
          name: stripHtml(fee.name),
          total: mapMoney(fee.totals?.total, fee.totals, fallback),
          totalTax: mapMoney(fee.totals?.total_tax, fee.totals, fallback),
        }]
      : [],
  );
}

function normalizeTaxLines(
  lines: WooCartTotals["tax_lines"],
  fallback: WooMoneyFields,
): CartTaxLine[] {
  return (lines ?? []).flatMap((line) =>
    line && typeof line.name === "string"
      ? [{
          name: stripHtml(line.name),
          price: mapMoney(line.price, fallback, fallback),
          rate: line.rate,
        }]
      : [],
  );
}

export function normalizeCart(
  value: unknown,
  freeShippingIds: ReadonlySet<number> = new Set(),
  freeShippingSlugs: ReadonlySet<string> = new Set(),
): Cart {
  const cart = value && typeof value === "object" ? (value as WooCart) : {};
  const totals = cart.totals ?? {};
  const minorUnit = totals.currency_minor_unit ?? 2;
  const money = (amount: unknown) => mapMoney(amount, totals, totals);
  return {
    items: (cart.items ?? [])
      .map((item) =>
        mapCartItem(item, minorUnit, freeShippingIds, freeShippingSlugs),
      )
      .filter((item): item is CartItem => item !== null),
    itemsCount: cart.items_count ?? 0,
    subtotal: minorToMajor(totals.total_items, minorUnit),
    currencyCode: totals.currency_code ?? "BRL",
    currencySymbol: totals.currency_symbol ?? "R$",
    currencyMinorUnit: minorUnit,
    coupons: (cart.coupons ?? []).flatMap((coupon) =>
      coupon && typeof coupon.code === "string"
        ? [{
            code: coupon.code,
            discountType: coupon.discount_type,
            totalDiscount: mapMoney(
              coupon.totals?.total_discount,
              coupon.totals,
              totals,
            ),
            totalDiscountTax: mapMoney(
              coupon.totals?.total_discount_tax,
              coupon.totals,
              totals,
            ),
          }]
        : [],
    ),
    fees: normalizeFees(cart.fees, totals),
    taxLines: normalizeTaxLines(totals.tax_lines, totals),
    totals: {
      items: money(totals.total_items),
      itemsTax: money(totals.total_items_tax),
      fees: money(totals.total_fees),
      feesTax: money(totals.total_fees_tax),
      discount: money(totals.total_discount),
      discountTax: money(totals.total_discount_tax),
      shipping: money(totals.total_shipping),
      shippingTax: money(totals.total_shipping_tax),
      price: money(totals.total_price),
      tax: money(totals.total_tax),
    },
    shippingAddress: normalizeAddress(cart.shipping_address),
    billingAddress: normalizeAddress(cart.billing_address),
    needsShipping: cart.needs_shipping === true,
    hasCalculatedShipping: cart.has_calculated_shipping === true,
    shippingPackages: normalizeShippingPackages(cart.shipping_rates, totals),
  };
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
    ...(address.email ? { email: address.email } : {}),
    ...(address.phone ? { phone: address.phone } : {}),
  };
}

async function cartRequest(
  endpoint: string,
  options: {
    method?: "GET" | "POST";
    cartToken?: string;
    body?: unknown;
  } = {},
): Promise<CartServiceResponse> {
  let response: Response;
  try {
    const startedAt = performance.now();
    response = await fetch(getCartUrl(endpoint), {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.cartToken ? { "Cart-Token": options.cartToken } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (process.env.WOO_REQUEST_DIAGNOSTICS === "1") {
      console.info("[woocommerce-outbound]", {
        api: "store-cart",
        endpoint,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        attempt: 1,
        cache: "no-store",
      });
    }
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new CartServiceError("O WooCommerce demorou para responder.", 504);
    }
    throw new CartServiceError("Não foi possível acessar o WooCommerce.", 502);
  }

  const payload = (await response.json().catch(() => null)) as
    | { code?: string; message?: string }
    | null;
  if (!response.ok) {
    throw new CartServiceError(
      payload?.message || "O WooCommerce não concluiu a operação.",
      response.status,
      payload?.code,
    );
  }
  let freeShippingIds: ReadonlySet<number> = new Set();
  let freeShippingSlugs: ReadonlySet<string> = new Set();
  try {
    const { getFreeShippingProducts } = await import("./freeShipping.ts");
    const freeShippingProducts = await getFreeShippingProducts();
    freeShippingIds = freeShippingProducts.ids;
    freeShippingSlugs = freeShippingProducts.slugs;
  } catch {
    // O carrinho e os cálculos oficiais nunca dependem do selo informativo.
  }
  return {
    cart: normalizeCart(
      payload,
      freeShippingIds,
      freeShippingSlugs,
    ),
    cartToken: response.headers.get("Cart-Token") ?? options.cartToken,
  };
}

export async function getCart(cartToken?: string) {
  return cartRequest("cart", { cartToken });
}

export async function addItemToCart(
  input: AddCartItemInput,
  cartToken?: string,
) {
  let activeToken = cartToken;
  if (!activeToken) {
    const initialCart = await getCart();
    activeToken = initialCart.cartToken;
  }
  return cartRequest("cart/add-item", {
    method: "POST",
    cartToken: activeToken,
    body: {
      id: input.productId,
      quantity: input.quantity,
      variation: input.variation,
    },
  });
}

export async function updateCartItem(
  key: string,
  quantity: number,
  cartToken: string,
) {
  return cartRequest("cart/update-item", {
    method: "POST",
    cartToken,
    body: { key, quantity },
  });
}

export async function removeCartItem(key: string, cartToken: string) {
  return cartRequest("cart/remove-item", {
    method: "POST",
    cartToken,
    body: { key },
  });
}

export async function applyCartCoupon(code: string, cartToken: string) {
  return cartRequest("cart/apply-coupon", {
    method: "POST",
    cartToken,
    body: { code },
  });
}

export async function removeCartCoupon(code: string, cartToken: string) {
  return cartRequest("cart/remove-coupon", {
    method: "POST",
    cartToken,
    body: { code },
  });
}

export async function updateCartCustomer(
  input: CheckoutCustomerPayload,
  cartToken: string,
) {
  return cartRequest("cart/update-customer", {
    method: "POST",
    cartToken,
    body: {
      billing_address: toWooAddress(input.billingAddress),
      shipping_address: toWooAddress(input.shippingAddress),
    },
  });
}

export async function updateCartShippingPostcode(
  postcode: string,
  cartToken: string,
) {
  const destination = {
    country: "BR",
    postcode,
  };

  return cartRequest("cart/update-customer", {
    method: "POST",
    cartToken,
    body: {
      billing_address: destination,
      shipping_address: destination,
    },
  });
}

export async function selectCartShippingRate(
  input: SelectShippingRateInput,
  cartToken: string,
) {
  return cartRequest("cart/select-shipping-rate", {
    method: "POST",
    cartToken,
    body: {
      package_id: input.packageId,
      rate_id: input.rateId,
    },
  });
}
