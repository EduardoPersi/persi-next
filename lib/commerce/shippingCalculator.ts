import type { Cart } from "@/types/cart";
import type {
  ProductShippingInput,
  ShippingQuote,
  ShippingSelection,
} from "@/types/shipping";

export const SHIPPING_CACHE_TTL_MS = 30 * 60 * 1000;
const SHIPPING_CACHE_PREFIX = "persi_shipping_quote:";
const LAST_POSTCODE_KEY = "persi_shipping_last_postcode";

export interface ShippingCacheEntry {
  contextKey: string;
  postcode: string;
  quote: ShippingQuote;
  selected?: ShippingSelection;
  timestamp: number;
}

export function normalizePostcode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function formatPostcode(value: string): string {
  const digits = normalizePostcode(value);
  return digits.length > 5
    ? `${digits.slice(0, 5)}-${digits.slice(5)}`
    : digits;
}

export function isValidPostcode(value: string): boolean {
  return /^\d{8}$/.test(normalizePostcode(value));
}

export function getCartShippingContextKey(cart: Cart | null): string {
  if (!cart) return "cart:empty";
  return `cart:${cart.items
    .map((item) => `${item.id}:${item.quantity}`)
    .sort()
    .join("|")}`;
}

export function getProductShippingContextKey(
  input: ProductShippingInput,
): string {
  return `product:${input.productId}:${input.variationId ?? 0}:${input.quantity}`;
}

function cacheKey(contextKey: string): string {
  return `${SHIPPING_CACHE_PREFIX}${contextKey}`;
}

export function readShippingCache(
  storage: Pick<Storage, "getItem">,
  contextKey: string,
  now = Date.now(),
): ShippingCacheEntry | null {
  try {
    const raw = storage.getItem(cacheKey(contextKey));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ShippingCacheEntry>;
    if (
      value.contextKey !== contextKey ||
      typeof value.postcode !== "string" ||
      !isValidPostcode(value.postcode) ||
      typeof value.timestamp !== "number" ||
      now - value.timestamp > SHIPPING_CACHE_TTL_MS ||
      !value.quote ||
      !Array.isArray(value.quote.packages)
    ) {
      return null;
    }
    return value as ShippingCacheEntry;
  } catch {
    return null;
  }
}

export function writeShippingCache(
  storage: Pick<Storage, "setItem">,
  entry: ShippingCacheEntry,
): void {
  try {
    storage.setItem(cacheKey(entry.contextKey), JSON.stringify(entry));
    if (typeof window !== "undefined") window.dispatchEvent(new Event("persi:shipping-cache"));
  } catch {
    // O cálculo continua funcionando quando o armazenamento está indisponível.
  }
}

export function readLastShippingPostcode(
  storage: Pick<Storage, "getItem">,
): string {
  const value = storage.getItem(LAST_POSTCODE_KEY) ?? "";
  return isValidPostcode(value) ? normalizePostcode(value) : "";
}

export function writeLastShippingPostcode(
  storage: Pick<Storage, "setItem">,
  postcode: string,
): void {
  if (!isValidPostcode(postcode)) return;
  try {
    storage.setItem(LAST_POSTCODE_KEY, normalizePostcode(postcode));
  } catch {
    // O CEP continua no estado da tela quando o armazenamento falha.
  }
}
