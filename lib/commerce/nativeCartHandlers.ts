import "server-only";

import { z } from "zod";
import {
  addNativeCartItem,
  canAccessNativeCart,
  createNativeCart,
  findActiveNativeCart,
  generateGuestCartToken,
  readNativeCartById,
  removeNativeCartItem,
  updateNativeCartItemQuantity,
  type NativeCartReadModel,
} from "@/lib/db/nativeCart";
import { resolveNativeVariantByWooProductId, resolveSingleActiveStore } from "./nativeCommerceCatalogResolution";
import { withIdempotency } from "./nativeCommerceIdempotency";
import { logNativeCommerceEvent } from "@/lib/observability/nativeCommerceEvents";

// Gate 3 -- all business logic for the new native cart routes, kept in a
// module that does NOT import "next/server" so it can be unit-tested
// directly under the plain Node test runner (route.ts files cannot be --
// this codebase's own established convention, see
// tests/nativeCheckoutHttpBoundary.test.mjs's file-level comment).
//
// No import from services/woocommerce anywhere in this file, on purpose:
// these routes must NEVER call WooCommerce (Gate 3's whole reason to
// exist -- see docs/native-commerce/gate3-native-cart-checkout-routes.md).
//
// Every DB/catalog-resolution seam takes an optional `deps` override,
// mirroring services/checkout/nativeCheckoutService.ts's own established
// mocks? pattern -- this is what lets the mandatory Gate 3 test matrix
// (unmapped product fails closed, idempotency-key replay, etc.) exercise
// real business logic without a live Postgres connection.

export type CartOwner = { customerId: string | null; guestToken: string | null };

export type HandlerFailure = { ok: false; status: number; code: string; message: string };
export type HandlerSuccess<T> = { ok: true; status: number; data: T; setGuestToken?: string };
export type HandlerResult<T> = HandlerSuccess<T> | HandlerFailure;

function ok<T>(status: number, data: T, setGuestToken?: string): HandlerSuccess<T> {
  return { ok: true, status, data, setGuestToken };
}
function fail(status: number, code: string, message: string): HandlerFailure {
  return { ok: false, status, code, message };
}

const GENERIC_ERROR = "Não foi possível atualizar o carrinho agora.";

function mapCartError(error: unknown): HandlerFailure {
  const message = error instanceof Error ? error.message : "";
  if (message === "CART_NOT_FOUND") return fail(404, "CART_NOT_FOUND", "Carrinho não encontrado.");
  if (message === "CART_NOT_MUTABLE") return fail(409, "CART_NOT_MUTABLE", "Este carrinho não está mais ativo.");
  if (message === "CART_OWNERSHIP_INVALID") return fail(403, "CART_OWNERSHIP_INVALID", "Este carrinho não pertence a você.");
  if (message === "CART_ITEM_NOT_FOUND") return fail(404, "CART_ITEM_NOT_FOUND", "Item não encontrado no carrinho.");
  if (message === "CART_QUANTITY_INVALID") return fail(422, "CART_QUANTITY_INVALID", "Quantidade inválida.");
  return fail(502, "CART_OPERATION_FAILED", GENERIC_ERROR);
}

function sanitizeCart(cart: NativeCartReadModel) {
  return {
    id: cart.id,
    currency: cart.currency,
    status: cart.status,
    version: cart.version.toString(),
    items: cart.items.map((item) => ({
      productVariantId: item.productVariantId,
      quantity: item.quantity.toString(),
    })),
  };
}

export interface GetCartDeps {
  resolveSingleActiveStore: typeof resolveSingleActiveStore;
  findActiveNativeCart: typeof findActiveNativeCart;
}
const defaultGetCartDeps: GetCartDeps = { resolveSingleActiveStore, findActiveNativeCart };

export async function handleGetNativeCart(
  owner: CartOwner,
  deps: GetCartDeps = defaultGetCartDeps,
): Promise<HandlerResult<ReturnType<typeof sanitizeCart> | null>> {
  const store = await deps.resolveSingleActiveStore();
  if (!store) return fail(503, "STORE_CONTEXT_UNAVAILABLE", GENERIC_ERROR);
  const cart = await deps.findActiveNativeCart({
    storeId: store.storeId,
    currency: store.currency,
    customerId: owner.customerId,
    guestToken: owner.guestToken ?? undefined,
  });
  if (!cart) return ok(200, null);
  return ok(200, sanitizeCart(cart));
}

export interface CreateOrGetCartDeps {
  resolveSingleActiveStore: typeof resolveSingleActiveStore;
  createNativeCart: typeof createNativeCart;
  readNativeCartById: typeof readNativeCartById;
  generateGuestCartToken: typeof generateGuestCartToken;
}
const defaultCreateOrGetCartDeps: CreateOrGetCartDeps = {
  resolveSingleActiveStore,
  createNativeCart,
  readNativeCartById,
  generateGuestCartToken,
};

export async function handleCreateOrGetNativeCart(
  owner: CartOwner,
  deps: CreateOrGetCartDeps = defaultCreateOrGetCartDeps,
): Promise<HandlerResult<ReturnType<typeof sanitizeCart>>> {
  const store = await deps.resolveSingleActiveStore();
  if (!store) return fail(503, "STORE_CONTEXT_UNAVAILABLE", GENERIC_ERROR);

  let guestToken = owner.guestToken;
  if (!owner.customerId && !guestToken) guestToken = deps.generateGuestCartToken();

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  try {
    // create_native_cart is idempotent by (store, currency, owner) on its
    // own -- a repeated call for the same owner always returns the SAME
    // cart, so no extra idempotency-key wrapper is needed here (unlike
    // add/update/remove item below).
    const cart = await deps.createNativeCart({
      storeId: store.storeId,
      customerId: owner.customerId,
      guestToken: guestToken ?? undefined,
      currency: store.currency,
      expiresAt,
    });
    logNativeCommerceEvent("native_cart_created", { cartId: cart.id });
    const full = await deps.readNativeCartById(cart.id);
    if (!full) return fail(502, "CART_OPERATION_FAILED", GENERIC_ERROR);
    return ok(201, sanitizeCart(full), owner.customerId ? undefined : guestToken ?? undefined);
  } catch (error) {
    return mapCartError(error);
  }
}

export const addCartItemInputSchema = z
  .object({
    wooProductId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(999),
    idempotencyKey: z.uuid(),
  })
  .strict();
export type AddCartItemInput = z.infer<typeof addCartItemInputSchema>;

export interface AddCartItemDeps {
  resolveNativeVariantByWooProductId: typeof resolveNativeVariantByWooProductId;
  addNativeCartItem: typeof addNativeCartItem;
}
const defaultAddCartItemDeps: AddCartItemDeps = { resolveNativeVariantByWooProductId, addNativeCartItem };

export async function handleAddNativeCartItem(
  cartId: string,
  owner: CartOwner,
  input: AddCartItemInput,
  deps: AddCartItemDeps = defaultAddCartItemDeps,
): Promise<HandlerResult<{ productVariantId: string; quantity: string }>> {
  const resolved = await deps.resolveNativeVariantByWooProductId(input.wooProductId);
  if (!resolved) {
    logNativeCommerceEvent("native_cart_request_rejected_product_not_mapped", { cartId });
    return fail(404, "PRODUCT_NOT_MAPPED", "Este produto não está disponível no momento.");
  }

  try {
    const item = await withIdempotency("cart:add-item", input.idempotencyKey, () =>
      deps.addNativeCartItem({
        cartId,
        customerId: owner.customerId,
        guestToken: owner.guestToken ?? undefined,
        productVariantId: resolved.productVariantId,
        quantity: BigInt(input.quantity),
      }),
    );
    logNativeCommerceEvent("native_cart_item_added", { cartId });
    return ok(200, { productVariantId: item.productVariantId, quantity: item.quantity.toString() });
  } catch (error) {
    return mapCartError(error);
  }
}

export const updateCartItemInputSchema = z
  .object({
    quantity: z.number().int().min(1).max(999),
    idempotencyKey: z.uuid(),
  })
  .strict();
export type UpdateCartItemInput = z.infer<typeof updateCartItemInputSchema>;

export interface UpdateCartItemDeps {
  updateNativeCartItemQuantity: typeof updateNativeCartItemQuantity;
}
const defaultUpdateCartItemDeps: UpdateCartItemDeps = { updateNativeCartItemQuantity };

export async function handleUpdateNativeCartItem(
  cartId: string,
  productVariantId: string,
  owner: CartOwner,
  input: UpdateCartItemInput,
  deps: UpdateCartItemDeps = defaultUpdateCartItemDeps,
): Promise<HandlerResult<{ productVariantId: string; quantity: string }>> {
  try {
    const item = await withIdempotency("cart:update-item", input.idempotencyKey, () =>
      deps.updateNativeCartItemQuantity({
        cartId,
        customerId: owner.customerId,
        guestToken: owner.guestToken ?? undefined,
        productVariantId,
        quantity: BigInt(input.quantity),
      }),
    );
    logNativeCommerceEvent("native_cart_item_updated", { cartId });
    return ok(200, { productVariantId: item.productVariantId, quantity: item.quantity.toString() });
  } catch (error) {
    return mapCartError(error);
  }
}

export const removeCartItemInputSchema = z.object({ idempotencyKey: z.uuid() }).strict();
export type RemoveCartItemInput = z.infer<typeof removeCartItemInputSchema>;

export interface RemoveCartItemDeps {
  removeNativeCartItem: typeof removeNativeCartItem;
}
const defaultRemoveCartItemDeps: RemoveCartItemDeps = { removeNativeCartItem };

export async function handleRemoveNativeCartItem(
  cartId: string,
  productVariantId: string,
  owner: CartOwner,
  input: RemoveCartItemInput,
  deps: RemoveCartItemDeps = defaultRemoveCartItemDeps,
): Promise<HandlerResult<{ removed: boolean }>> {
  try {
    const removed = await withIdempotency("cart:remove-item", input.idempotencyKey, () =>
      deps.removeNativeCartItem({
        cartId,
        customerId: owner.customerId,
        guestToken: owner.guestToken ?? undefined,
        productVariantId,
      }),
    );
    logNativeCommerceEvent("native_cart_item_removed", { cartId });
    return ok(200, { removed });
  } catch (error) {
    return mapCartError(error);
  }
}

// Exported for the route layer's ownership pre-check (canAccessNativeCart
// itself is already exported/tested by lib/db/nativeCart.ts -- re-exported
// here so route.ts files only need to import from this one module).
export { canAccessNativeCart };
