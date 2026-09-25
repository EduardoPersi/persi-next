import "server-only";

import { z } from "zod";
import { CheckoutPiiValidationError } from "./checkoutPii";
import { canAccessNativeCart, generateGuestCartToken, readNativeCartById, verifyGuestCartToken } from "@/lib/db/nativeCart";
import { markNativeCheckoutReady, prepareNativeCheckout, readNativeCheckoutOwnership } from "@/lib/db/nativeCheckout";
import { persistNativeCheckoutPii } from "@/lib/db/nativeCheckoutPii";
import { resolveStorePriceAuthority } from "@/lib/db/nativePriceAuthority";
import { resolveSingleActiveInventoryLocation, resolveSingleActiveStore } from "./nativeCommerceCatalogResolution";
import { withIdempotency } from "./nativeCommerceIdempotency";
import { logNativeCommerceEvent } from "@/lib/observability/nativeCommerceEvents";
import { extractPostgresErrorCode, extractPostgresErrorMessage } from "@/lib/db/postgresErrorMessage";

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

// `field`: a fixed dot-path ("contact.phone", "billing.postalCode") naming
// which input field failed validation -- present only for
// CHECKOUT_PII_INVALID, never a value, safe to return to the client.
export type HandlerFailure = { ok: false; status: number; code: string; message: string; field?: string };
export type HandlerSuccess<T> = { ok: true; status: number; data: T };
export type HandlerResult<T> = HandlerSuccess<T> | HandlerFailure;

function ok<T>(status: number, data: T): HandlerSuccess<T> {
  return { ok: true, status, data };
}
function fail(status: number, code: string, message: string, field?: string): HandlerFailure {
  return { ok: false, status, code, message, field };
}

const GENERIC_ERROR = "Não foi possível preparar o checkout agora.";
const STALE_MESSAGE = "O checkout foi atualizado. Recarregue a página e tente novamente.";

// `route` identifies the call site for the unexpected-error log line only
// (Seção 9 do design: "rota, error.name/código do Postgres") -- it is
// never part of the HTTP response.
//
// Gate 3 staging smoke test (2026-09-23) found two compounding bugs here:
// 1. `error.message` never carries a real Postgres RAISE's text (it's
//    wrapped in drizzle's `.cause` -- see lib/db/postgresErrorMessage.ts),
//    so this function only ever recognized the synthetic errors its own
//    unit tests throw. Every genuine failure fell through to 502.
// 2. Several real codes the underlying SQL functions raise
//    (CHECKOUT_PII_REQUIRED_OR_EXPIRED, CHECKOUT_OWNER_DENIED,
//    CHECKOUT_VERSION_CONFLICT, CHECKOUT_STATE_INVALID, ...) were never
//    listed at all. Comparison is uppercase-normalized because the
//    underlying migrations are inconsistent about casing (some
//    functions raise `CHECKOUT_OWNER_DENIED`, others `checkout_owner_denied`).
function mapCheckoutError(error: unknown, route: string): HandlerFailure {
  // CheckoutPiiValidationError comes from canonicalizeCheckoutPii
  // (lib/commerce/checkoutPii.ts) -- a pure, in-process validation
  // failure, never a Postgres RAISE, so it's checked before (and instead
  // of) the .cause-unwrapping message extraction below.
  if (error instanceof CheckoutPiiValidationError) {
    return fail(422, "CHECKOUT_PII_INVALID", "Dados de contato/endereço inválidos.", error.field);
  }

  const message = extractPostgresErrorMessage(error).toUpperCase();

  // Gate 3 staging (2026-09-24): environmentCheckoutPiiKeys()
  // (lib/commerce/checkoutPii.ts, called from inside persistNativeCheckoutPii
  // -- lib/db/nativeCheckoutPii.ts) throws a PLAIN `new Error("CHECKOUT_PII_..._INVALID")`
  // when CHECKOUT_PII_KEY_ID/CHECKOUT_PII_ENCRYPTION_KEYS_JSON/CHECKOUT_PII_HMAC_KEY
  // are missing or malformed -- never a Postgres RAISE, so it happens
  // before any database call. Left unmapped, it fell into the generic
  // "unexpected" branch below, whose log line only ever captures
  // extractPostgresErrorCode's fallback (Error.prototype.name, which is
  // the literal string "Error" for every plain Error -- the actual
  // message, the one piece of information that would have named the
  // missing variable, was discarded). Mapped explicitly here into a
  // stable, non-PII code instead -- this is a server misconfiguration
  // (503), never something the client can fix by resubmitting, and never
  // safe to proceed past: no PII is ever persisted without working crypto.
  if (message === "CHECKOUT_PII_KEY_ID_INVALID" || message === "CHECKOUT_PII_KEYS_INVALID") {
    logNativeCommerceEvent("native_commerce_unexpected_error", { route, code: "PII_ENCRYPTION_KEY_MISSING" });
    return fail(503, "PII_ENCRYPTION_KEY_MISSING", GENERIC_ERROR);
  }
  if (
    message === "CHECKOUT_PII_KEY_INVALID" ||
    message === "CHECKOUT_PII_HMAC_KEY_INVALID" ||
    message === "CHECKOUT_PII_IV_INVALID" ||
    message === "CHECKOUT_PII_UNKNOWN_KEY"
  ) {
    logNativeCommerceEvent("native_commerce_unexpected_error", { route, code: "PII_ENCRYPTION_KEY_INVALID" });
    return fail(503, "PII_ENCRYPTION_KEY_INVALID", GENERIC_ERROR);
  }

  if (message === "CHECKOUT_NOT_FOUND" || message === "CART_NOT_FOUND") {
    return fail(404, "CHECKOUT_NOT_FOUND", "Checkout não encontrado.");
  }
  // 404, not 403: a checkout whose owner (customer/guest fingerprint)
  // doesn't match the caller must look identical to "not found" -- same
  // fail-closed rule as CART_OWNERSHIP_INVALID in nativeCartHandlers.ts,
  // uniform across every Gate 3 route (confirmed 2026-09-23).
  if (message === "CHECKOUT_OWNER_DENIED") {
    return fail(404, "CHECKOUT_NOT_FOUND", "Checkout não encontrado.");
  }
  if (
    message === "CHECKOUT_PII_EXPIRED" ||
    message === "CHECKOUT_PII_REQUIRED_OR_EXPIRED" ||
    message === "CHECKOUT_PII_EXPIRY_INVALID"
  ) {
    return fail(422, "CHECKOUT_PII_REQUIRED", "Complete seus dados de contato e endereço antes de prosseguir.");
  }
  if (message === "CHECKOUT_PII_INVALID" || message === "INVALID_CHECKOUT_REQUEST" || message === "INVALID_PRICE_LIST_CONTEXT") {
    return fail(422, "CHECKOUT_PII_INVALID", "Dados de contato/endereço inválidos.");
  }
  if (message === "NATIVE_CHECKOUT_OWNER_CONTEXT_INVALID") {
    return fail(422, "OWNER_CONTEXT_INVALID", "Dados de identificação inválidos.");
  }
  if (
    message === "CHECKOUT_VERSION_CONFLICT" ||
    message === "CHECKOUT_STATE_INVALID" ||
    message === "CHECKOUT_EXPIRED" ||
    message === "CHECKOUT_CART_STATE_INVALID" ||
    message === "CHECKOUT_NOT_REUSABLE" ||
    message === "CHECKOUT_PRICE_STALE" ||
    message === "CHECKOUT_RESERVATION_INVALID" ||
    message === "CHECKOUT_SHIPPING_QUOTE_INVALID" ||
    message === "CHECKOUT_IDEMPOTENCY_PAYLOAD_CONFLICT"
  ) {
    return fail(409, "CHECKOUT_STALE", STALE_MESSAGE);
  }
  // Anything else is genuinely unexpected -- log it (route + a sanitized
  // code only, never the raw message/payload) so it doesn't disappear
  // silently the way this exact class of bug did in staging.
  logNativeCommerceEvent("native_commerce_unexpected_error", { route, code: extractPostgresErrorCode(error) });
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
  // Gate 3 staging (2026-09-24): the whole body runs in one try/catch, not
  // just the final prepareNativeCheckout call -- resolveSingleActiveStore/
  // readNativeCartById/etc. are real DB calls too, and a permission or
  // connection error from any of them must never escape uncaught (see
  // nativeCartHandlers.ts's file-level comment for the staging incident
  // this generalizes from).
  let cartId: string | undefined;
  try {
    const store = await deps.resolveSingleActiveStore();
    if (!store) return fail(503, "STORE_CONTEXT_UNAVAILABLE", GENERIC_ERROR);
    const inventoryLocationId = await deps.resolveSingleActiveInventoryLocation();
    if (!inventoryLocationId) return fail(503, "INVENTORY_LOCATION_UNAVAILABLE", GENERIC_ERROR);

    const cart = await deps.readNativeCartById(input.cartId);
    if (!cart) return fail(404, "CART_NOT_FOUND", "Carrinho não encontrado.");
    cartId = cart.id;
    const authorized = deps.canAccessNativeCart({
      requestedStoreId: store.storeId,
      cartStoreId: cart.storeId,
      cartCustomerId: cart.customerId,
      guestTokenFingerprint: cart.guestTokenFingerprint,
      owner: owner.customerId
        ? { kind: "customer", customerId: owner.customerId }
        : { kind: "guest", token: owner.guestToken ?? "" },
    });
    // 404, not 403 -- same fail-closed rule as everywhere else in Gate 3
    // (confirmed 2026-09-23): a cart that isn't yours must look like it
    // doesn't exist.
    if (!authorized) return fail(404, "CART_NOT_FOUND", "Carrinho não encontrado.");
    if (cart.items.length < 1) return fail(422, "CART_EMPTY", "O carrinho está vazio.");

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
    logNativeCommerceEvent("native_checkout_prepare_failed", { cartId, code: extractPostgresErrorMessage(error) || "unknown" });
    return mapCheckoutError(error, "POST /api/checkout/native/prepare");
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
  readNativeCheckoutOwnership: typeof readNativeCheckoutOwnership;
  readNativeCartById: typeof readNativeCartById;
  persistNativeCheckoutPii: typeof persistNativeCheckoutPii;
}
const defaultPersistPiiDeps: PersistPiiDeps = { readNativeCheckoutOwnership, readNativeCartById, persistNativeCheckoutPii };

// Gate 3 staging smoke test (2026-09-23/24): same ownership-before-state
// rule as requireOwnedCart in nativeCartHandlers.ts -- persist_checkout_pii
// (supabase/migrations/20260904010000_secure_checkout_pii_foundation.sql)
// checks CHECKOUT_STATE_INVALID/CHECKOUT_EXPIRED before CHECKOUT_OWNER_DENIED,
// so a wrong/tampered cookie against a checkout that's already `ready` (or
// expired) would get a different status than against one that doesn't
// exist -- checked here, in TypeScript, before that SQL function is ever
// called, so ownership failure always looks identical to "not found".
// Checkout ownership for a guest is derived from the checkout's own cart
// (checkout_sessions has no guest fingerprint column of its own; the cart
// it was created from does) -- the exact same derivation
// prepare_native_checkout's own SQL uses. Uses readNativeCheckoutOwnership
// (a minimal checkout_sessions-only query), never the wider readNativeCheckout
// -- see that function's own comment for why (a real 42501 in staging).
//
// Not wrapped in its own try/catch -- handlePersistNativeCheckoutPii below
// wraps this call together with everything else in one handler-wide
// try/catch instead (same shape as requireOwnedCart in
// nativeCartHandlers.ts). A DB error during ownership verification must
// never escape uncaught the way it did in staging (an unhandled exception
// with a raw "Failed query: ..." Next.js error page).
async function requireOwnedCheckout(checkoutId: string, owner: CheckoutOwner, deps: PersistPiiDeps): Promise<HandlerFailure | null> {
  const checkout = await deps.readNativeCheckoutOwnership(checkoutId);
  if (!checkout) return fail(404, "CHECKOUT_NOT_FOUND", "Checkout não encontrado.");
  if (owner.customerId) {
    if (checkout.customerId !== owner.customerId) return fail(404, "CHECKOUT_NOT_FOUND", "Checkout não encontrado.");
    return null;
  }
  const cart = await deps.readNativeCartById(checkout.cartId);
  if (!cart || cart.guestTokenFingerprint === null || !verifyGuestCartToken(owner.guestToken ?? "", cart.guestTokenFingerprint)) {
    return fail(404, "CHECKOUT_NOT_FOUND", "Checkout não encontrado.");
  }
  return null;
}

export async function handlePersistNativeCheckoutPii(
  owner: CheckoutOwner,
  input: PersistPiiInput,
  deps: PersistPiiDeps = defaultPersistPiiDeps,
): Promise<HandlerResult<{ checkoutId: string; checkoutVersion: string }>> {
  if (!owner.customerId && !owner.guestToken) return fail(422, "OWNER_CONTEXT_INVALID", "Dados de identificação inválidos.");
  try {
    const ownershipError = await requireOwnedCheckout(input.checkoutId, owner, deps);
    if (ownershipError) return ownershipError;

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
    return mapCheckoutError(error, "POST /api/checkout/native/pii");
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
    return mapCheckoutError(error, "POST /api/checkout/native/ready");
  }
}

export { generateGuestCartToken };
