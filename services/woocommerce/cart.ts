import type { Cart, CartItem } from "@/types/cart";
import { stripHtml } from "./mappers";

const REQUEST_TIMEOUT_MS = 10_000;

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
  variation?: Array<{
    attribute?: string;
    value?: string;
  }>;
  quantity?: number;
  quantity_limits?: {
    minimum?: number;
    maximum?: number;
    multiple_of?: number;
  };
  images?: WooCartImage[];
  prices?: {
    price?: string;
    currency_minor_unit?: number;
  };
  totals?: {
    line_total?: string;
  };
}

interface WooCart {
  items?: WooCartItem[];
  items_count?: number;
  totals?: {
    total_items?: string;
    currency_code?: string;
    currency_symbol?: string;
    currency_minor_unit?: number;
  };
}

export interface CartServiceResponse {
  cart: Cart;
  cartToken?: string;
}

export interface AddCartItemInput {
  productId: number;
  quantity: number;
  variation?: Array<{
    attribute: string;
    value: string;
  }>;
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

export class CartServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
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

function minorToMajor(value: string | undefined, minorUnit: number) {
  return value && /^\d+$/.test(value)
    ? Number(value) / 10 ** minorUnit
    : 0;
}

function mapCartItem(item: WooCartItem, minorUnit: number): CartItem | null {
  if (
    typeof item.key !== "string" ||
    typeof item.id !== "number" ||
    typeof item.name !== "string" ||
    typeof item.quantity !== "number"
  ) {
    return null;
  }

  const image = item.images?.[0];

  return {
    key: item.key,
    id: item.id,
    productId: item.id,
    variationId: item.variation?.length ? item.id : undefined,
    name: stripHtml(item.name),
    sku: item.sku ? stripHtml(item.sku) : undefined,
    permalink: item.permalink,
    slug: getSlug(item.permalink),
    variation: (item.variation ?? []).flatMap((attribute) =>
      attribute.attribute && attribute.value
        ? [
            {
              attribute: attribute.attribute,
              label: getVariationLabel(attribute.attribute),
              value: stripHtml(attribute.value),
            },
          ]
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
      ? {
          src: image.src,
          alt: stripHtml(image.alt || item.name),
        }
      : undefined,
    price: minorToMajor(item.prices?.price, minorUnit),
    total: minorToMajor(item.totals?.line_total, minorUnit),
  };
}

function mapCart(value: unknown): Cart {
  const cart = value && typeof value === "object" ? (value as WooCart) : {};
  const minorUnit = cart.totals?.currency_minor_unit ?? 2;

  return {
    items: (cart.items ?? [])
      .map((item) => mapCartItem(item, minorUnit))
      .filter((item): item is CartItem => item !== null),
    itemsCount: cart.items_count ?? 0,
    subtotal: minorToMajor(cart.totals?.total_items, minorUnit),
    currencyCode: cart.totals?.currency_code ?? "BRL",
    currencySymbol: cart.totals?.currency_symbol ?? "R$",
    currencyMinorUnit: minorUnit,
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
  const response = await fetch(getCartUrl(endpoint), {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.cartToken
        ? { "Cart-Token": options.cartToken }
        : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => null)) as
    | { message?: string }
    | null;

  if (!response.ok) {
    throw new CartServiceError(
      payload?.message || "O WooCommerce não concluiu a operação.",
      response.status,
    );
  }

  return {
    cart: mapCart(payload),
    cartToken: response.headers.get("Cart-Token") ?? options.cartToken,
  };
}

export async function getCart(
  cartToken?: string,
): Promise<CartServiceResponse> {
  return cartRequest("cart", { cartToken });
}

export async function addItemToCart(
  input: AddCartItemInput,
  cartToken?: string,
): Promise<CartServiceResponse> {
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
): Promise<CartServiceResponse> {
  return cartRequest("cart/update-item", {
    method: "POST",
    cartToken,
    body: { key, quantity },
  });
}

export async function removeCartItem(
  key: string,
  cartToken: string,
): Promise<CartServiceResponse> {
  return cartRequest("cart/remove-item", {
    method: "POST",
    cartToken,
    body: { key },
  });
}
