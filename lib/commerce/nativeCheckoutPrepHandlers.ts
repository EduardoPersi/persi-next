import "server-only";

import { z } from "zod";
import { canAccessNativeCart, generateGuestCartToken, readNativeCartById } from "@/lib/db/nativeCart";
import { markNativeCheckoutReady, prepareNativeCheckout } from "@/lib/db/nativeCheckout";
import { persistNativeCheckoutPii } from "@/lib/db/nativeCheckoutPii";
import { resolveStorePriceAuthority } from "@/lib/db/nativePriceAuthority";
import { resolveSingleActiveInventoryLocation, resolveSingleActiveStore } from "./nativeCommerceCatalogResolution";
import { withIdempotency } from "./nativeCommerceIdempotency";
import { logNativeCommerceEvent } from "@/lib/observability/nativeCommerceEvents";

// Gate 3 -- business logic for prepare/pii/ready, kept next/server-free
// for the same reason as nativeCartHandlers.ts. No import from
// services/woocommerce anywhere in this file. Every DB/catalog seam takes
// an optional `deps` override (same mocks? pattern as
// services/checkout/nativeCheckoutService.ts) so this can be unit-tested
// without a live Postgres connection.
//
// KNOWN, DISCLOSED GAP (see docs/native-commerce/gate3-native-cart-checkout-routes.md):
// prepare_native_checkout requires a full shipping quote when
// shippingRequired=true (provider, carrier, amount, destination
// fingerprint, etc.) -- there is no existing native (non-Woo) shipping
// quote resolver in this codebase yet, and building one is a real,
// separate piece of work, not something this phase can safely fake:
// price/shipping authority must never come from client input (design
// point d), so this phase only supports shippingRequired=false. Building
// a real native shipping-quote resolver is out of scope here.

export type CheckoutOwner = { customerId: string | null; guestToken: string | null };

export type HandlerFailure = { ok: false; status: number; code: string; message: string };
export type HandlerSuccess<T> = { ok: true; status: number; data: T };
export type HandlerResult<T> = HandlerSuccess<T> | HandlerFailure;

function ok<T>(status: number, data: T): HandlerSuccess<T> {
  return { ok: true, status, data };
}
function fail(status: number, code: string, message: string): HandlerFailure {
  return { ok: false, status, code, message };
}

const GENERIC_ERROR = "Não foi possível preparar o checkout agora.";

function mapCheckoutError(error: unknown): HandlerFailure {
  const message = error instanceof Error ? error.message : "";
  if (message === "CHECKOUT_NOT_FOUND") return fail(404, "CHECKOUT_NOT_FOUND", "Checkout não encontrado.");
  if (message === "CHECKOUT_PII_EXPIRED") return fail(422, "CHECKOUT_PII_EXPIRED", "Sessão de checkout expirada. Recomece.");
  if (message === "CHECKOUT_PII_INVALID") return fail(422, "CHECKOUT_PII_INVALID", "Dados de contato/endereço inválidos.");
  if (message === "NATIVE_CHECKOUT_OWNER_CONTEXT_INVALID") return fail(422, "OWNER_CONTEXT_INVALID", "Dados de identificação inválidos.");
  return fail(502, "CHECKOUT_OPERATION_FAILED", GENERIC_ERROR);
}

export const prepareCheckoutInputSchema = z
  .object({
    cartId: z.uuid(),
    idempotencyKey: z.uuid(),
    shippingRequired: z.literal(false),
  })
  .strict();
export type PrepareCheckoutInput = z.infer<typeof prepareCheckoutInputSchema>;

export interface PrepareCheckoutDeps {
  resolveSingleActiveStore: typeof resolveSingleActiveStore;
  resolveSingleActiveInventoryLocation: typeof resolveSingleActiveInventoryLocation;
  readNativeCartById: typeof readNativeCartById;
  canAccessNativeCart: typeof canAccessNativeCart;
  resolveStorePriceAuthority: typeof resolveStorePriceAuthority;
  prepareNativeCheckout: typeof prepareNativeCheckout;
}
const defaultPrepareCheckoutDeps: PrepareCheckoutDeps = {
  resolveSingleActiveStore,
  resolveSingleActiveInventoryLocation,
  readNativeCartById,
  canAccessNativeCart,
  resolveStorePriceAuthority,
  prepareNativeCheckout,
};

export async function handlePrepareNativeCheckout(
  owner: CheckoutOwner,
  input: PrepareCheckoutInput,
  deps: PrepareCheckoutDeps = defaultPrepareCheckoutDeps,
): Promise<HandlerResult<{ checkoutId: string; status: string; version: string }>> {
  const store = await deps.resolveSingleActiveStore();
  if (!store) return fail(503, "STORE_CONTEXT_UNAVAILABLE", GENERIC_ERROR);
  const inventoryLocationId = await deps.resolveSingleActiveInventoryLocation();
  if (!inventoryLocationId) return fail(503, "INVENTORY_LOCATION_UNAVAILABLE", GENERIC_ERROR);

  const cart = await deps.readNativeCartById(input.cartId);
  if (!cart) return fail(404, "CART_NOT_FOUND", "Carrinho não encontrado.");
  const authorized = deps.canAccessNativeCart({
    requestedStoreId: store.storeId,
    cartStoreId: cart.storeId,
    cartCustomerId: cart.customerId,
    guestTokenFingerprint: cart.guestTokenFingerprint,
    owner: owner.customerId
      ? { kind: "customer", customerId: owner.customerId }
      : { kind: "guest", token: owner.guestToken ?? "" },
  });
  if (!authorized) return fail(403, "CART_OWNERSHIP_INVALID", "Este carrinho não pertence a você.");
  if (cart.items.length < 1) return fail(422, "CART_EMPTY", "O carrinho está vazio.");

  try {
    const result = await withIdempotency("checkout:prepare", input.idempotencyKey, async () => {
      const priceAuthority = await deps.resolveStorePriceAuthority({ storeId: store.storeId, currency: store.currency, asOf: new Date() });
      return deps.prepareNativeCheckout({
        storeId: store.storeId,
        cartId: cart.id,
        customerId: owner.customerId,
        cartVersion: cart.version,
        priceListId: priceAuthority.priceListId,
        inventoryLocationId,
        currency: store.currency,
        shippingRequired: false,
        idempotencyKey: input.idempotencyKey,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        guestToken: owner.guestToken ?? undefined,
      });
    });
    const checkoutId = (result as { id: string }).id;
    logNativeCommerceEvent("native_checkout_prepared", { cartId: cart.id, checkoutId });
    return ok(201, {
      checkoutId,
      status: (result as { status: string }).status,
      version: (result as { version: bigint }).version.toString(),
    });
  } catch (error) {
    logNativeCommerceEvent("native_checkout_prepare_failed", { cartId: cart.id, code: error instanceof Error ? error.message : "unknown" });
    return mapCheckoutError(error);
  }
}

export const persistPiiInputSchema = z
  .object({
    checkoutId: z.uuid(),
    expectedVersion: z.string().regex(/^\d{1,20}$/),
    idempotencyKey: z.uuid(),
    pii: z.unknown(),
  })
  .strict();
export type PersistPiiInput = z.infer<typeof persistPiiInputSchema>;

export interface PersistPiiDeps {
  persistNativeCheckoutPii: typeof persistNativeCheckoutPii;
}
const defaultPersistPiiDeps: PersistPiiDeps = { persistNativeCheckoutPii };

export async function handlePersistNativeCheckoutPii(
  owner: CheckoutOwner,
  input: PersistPiiInput,
  deps: PersistPiiDeps = defaultPersistPiiDeps,
): Promise<HandlerResult<{ checkoutId: string; checkoutVersion: string }>> {
  if (!owner.customerId && !owner.guestToken) return fail(422, "OWNER_CONTEXT_INVALID", "Dados de identificação inválidos.");
  try {
    const result = await withIdempotency("checkout:pii", input.idempotencyKey, () =>
      deps.persistNativeCheckoutPii({
        checkoutId: input.checkoutId,
        expectedVersion: BigInt(input.expectedVersion),
        owner: owner.customerId ? { customerId: owner.customerId } : { guestToken: owner.guestToken as string },
        pii: input.pii,
      }),
    );
    // Never log input.pii or the envelope -- only identifiers (design point h).
    logNativeCommerceEvent("native_checkout_pii_persisted", { checkoutId: result.checkoutId });
    return ok(200, { checkoutId: result.checkoutId, checkoutVersion: result.checkoutVersion.toString() });
  } catch (error) {
    return mapCheckoutError(error);
  }
}

export const markReadyInputSchema = z
  .object({
    checkoutId: z.uuid(),
    expectedVersion: z.string().regex(/^\d{1,20}$/),
    expectedPiiFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type MarkReadyInput = z.infer<typeof markReadyInputSchema>;

export interface MarkReadyDeps {
  markNativeCheckoutReady: typeof markNativeCheckoutReady;
}
const defaultMarkReadyDeps: MarkReadyDeps = { markNativeCheckoutReady };

export async function handleMarkNativeCheckoutReady(
  owner: CheckoutOwner,
  input: MarkReadyInput,
  deps: MarkReadyDeps = defaultMarkReadyDeps,
): Promise<HandlerResult<{ checkoutId: string }>> {
  try {
    // mark_native_checkout_ready returns the raw `checkout_sessions` row
    // (`returns public.checkout_sessions`), selected via a bare `select *`
    // with no column aliasing -- so the column is `id`, not `checkoutId`/
    // `checkout_id` (unlike readNativeCheckout/readNativeCartById, which
    // both alias explicitly). Not read here -- input.checkoutId is already
    // the validated identifier and a mismatch would have thrown above.
    await deps.markNativeCheckoutReady({
      checkoutId: input.checkoutId,
      customerId: owner.customerId,
      guestToken: owner.guestToken ?? undefined,
      expectedVersion: BigInt(input.expectedVersion),
      expectedPiiFingerprint: input.expectedPiiFingerprint,
    });
    logNativeCommerceEvent("native_checkout_marked_ready", { checkoutId: input.checkoutId });
    return ok(200, { checkoutId: input.checkoutId });
  } catch (error) {
    return mapCheckoutError(error);
  }
}

export { generateGuestCartToken };
