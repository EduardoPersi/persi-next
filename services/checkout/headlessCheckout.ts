import type { Cart } from "@/types/cart";
import {
  CheckoutTransferError,
  type CheckoutTransferItem,
} from "../../lib/commerce/checkoutTransfer.ts";

interface TransferProductReference {
  id?: unknown;
  parent?: unknown;
  type?: unknown;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

async function resolveCartItemReference(
  itemId: number,
): Promise<{ productId: number; variationId: number }> {
  const { storeApiGet } = await import("../woocommerce/client.ts");
  const value = await storeApiGet<unknown>(`products/${itemId}`, {
    revalidate: 0,
  });

  if (!value || typeof value !== "object") {
    throw new CheckoutTransferError(422, "Cart product could not be resolved");
  }

  const product = value as TransferProductReference;

  if (product.id !== itemId) {
    throw new CheckoutTransferError(422, "Cart product could not be resolved");
  }

  if (product.type === "simple") {
    return { productId: itemId, variationId: 0 };
  }

  if (product.type === "variation" && isPositiveInteger(product.parent)) {
    return {
      productId: product.parent,
      variationId: itemId,
    };
  }

  throw new CheckoutTransferError(422, "Unsupported cart product type");
}

export async function getAuthoritativeCheckoutItems(
  cart: Cart,
  productResolver: (
    itemId: number,
  ) => Promise<{ productId: number; variationId: number }> =
    resolveCartItemReference,
): Promise<CheckoutTransferItem[]> {
  if (cart.items.length < 1) {
    throw new CheckoutTransferError(422, "Cart is empty");
  }

  const uniqueItemIds = [...new Set(cart.items.map((item) => item.id))];
  const references = await Promise.all(
    uniqueItemIds.map(async (itemId) => [
      itemId,
      await productResolver(itemId),
    ] as const),
  );
  const referenceById = new Map(references);
  const aggregated = new Map<string, CheckoutTransferItem>();

  for (const item of cart.items) {
    const reference = referenceById.get(item.id);

    if (
      !reference ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 999
    ) {
      throw new CheckoutTransferError(422, "Cart contains an invalid item");
    }

    const key = `${reference.productId}:${reference.variationId}`;
    const existing = aggregated.get(key);
    const quantity = (existing?.quantity ?? 0) + item.quantity;

    if (quantity > 999) {
      throw new CheckoutTransferError(422, "Cart quantity is too large");
    }

    aggregated.set(key, {
      ...reference,
      quantity,
    });
  }

  return [...aggregated.values()];
}
