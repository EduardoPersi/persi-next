import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { withPersiRole } from "./nativeCommerceAuthority";

export const NATIVE_CART_TOKEN_BYTES = 32;

export function generateGuestCartToken(): string {
  return randomBytes(NATIVE_CART_TOKEN_BYTES).toString("base64url");
}
export function hashGuestCartToken(token: string): string {
  if (!token || token.length < 32) throw new Error("invalid_guest_cart_token");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifyGuestCartToken(token: string, expectedFingerprint: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedFingerprint)) return false;
  let actual: Buffer;
  try {
    actual = Buffer.from(hashGuestCartToken(token), "hex");
  } catch {
    return false;
  }
  return timingSafeEqual(actual, Buffer.from(expectedFingerprint, "hex"));
}

export type NativeCartOwner =
  | { kind: "guest"; token: string }
  | { kind: "customer"; customerId: string };

export function canAccessNativeCart(input: {
  requestedStoreId: string;
  cartStoreId: string;
  cartCustomerId: string | null;
  guestTokenFingerprint: string | null;
  owner: NativeCartOwner;
}): boolean {
  if (input.requestedStoreId !== input.cartStoreId) return false;
  if (input.owner.kind === "customer") {
    return input.cartCustomerId === input.owner.customerId;
  }
  return input.cartCustomerId === null && input.guestTokenFingerprint !== null
    && verifyGuestCartToken(input.owner.token, input.guestTokenFingerprint);
}

// B.3-I — minimal cart-mutation wrappers. Neither create_native_cart nor
// add_native_cart_item had a TypeScript wrapper before this round (only
// exercised via raw SQL in scripts/database/native-cart-*-concurrency.mjs)
// -- these mirror that exact, already-proven calling convention
// (argument order, guest-token-to-fingerprint hashing) rather than
// inventing a new one. Both run as persi_app (lib/db/nativeCommerceAuthority.ts,
// docs/database/88) -- 20260905180000_native_checkout_atomic_submission.sql
// narrowed every cart-mutation function to persi_app only, revoking the
// persi_worker grant the cart foundation migration originally gave them.
export interface NativeCartRow {
  [key: string]: unknown;
  id: string;
  storeId: string;
  customerId: string | null;
  currency: string;
  status: string;
  version: bigint;
}

// Idempotent (create_native_cart's own contract): one active cart per
// (store, currency, owner) -- a retried call for the same owner returns
// the SAME cart, never a duplicate.
export async function createNativeCart(input: {
  storeId: string;
  customerId?: string | null;
  guestToken?: string;
  currency: string;
  expiresAt: Date;
}): Promise<NativeCartRow> {
  if (input.customerId && input.guestToken) throw new Error("NATIVE_CART_OWNER_CONTEXT_INVALID");
  const guestFingerprint = input.guestToken ? hashGuestCartToken(input.guestToken) : null;
  const result = await withPersiRole("persi_app", (db) => db.execute<NativeCartRow>(sql`
    select id::text as "id", store_id::text as "storeId", customer_id::text as "customerId", currency, status, version
    from public.create_native_cart(${input.storeId}::uuid, ${input.customerId ?? null}::uuid, ${guestFingerprint}::text, ${input.currency}::char(3), ${input.expiresAt.toISOString()}::timestamptz)
  `));
  return result[0];
}

export interface NativeCartItemRow {
  [key: string]: unknown;
  id: string;
  cartId: string;
  productVariantId: string;
  quantity: bigint;
}

// Idempotent by (cart, variant): a retried call ADDS quantity (matching
// the SQL function's own upsert-accumulate contract), it does not create a
// second line for the same variant.
export async function addNativeCartItem(input: {
  cartId: string;
  customerId?: string | null;
  guestToken?: string;
  productVariantId: string;
  quantity: bigint;
}): Promise<NativeCartItemRow> {
  if (input.customerId && input.guestToken) throw new Error("NATIVE_CART_OWNER_CONTEXT_INVALID");
  const guestFingerprint = input.guestToken ? hashGuestCartToken(input.guestToken) : null;
  const result = await withPersiRole("persi_app", (db) => db.execute<NativeCartItemRow>(sql`
    select id::text as "id", cart_id::text as "cartId", product_variant_id::text as "productVariantId", quantity
    from public.add_native_cart_item(${input.cartId}::uuid, ${input.customerId ?? null}::uuid, ${guestFingerprint}::text, ${input.productVariantId}::uuid, ${input.quantity}::bigint)
  `));
  return result[0];
}

// Gate 3 -- sets the ABSOLUTE quantity for an existing line (unlike
// addNativeCartItem, which accumulates). Mirrors set_native_cart_item_quantity's
// own contract exactly (supabase/migrations/20260907120000_native_cart_authority_null_safe.sql):
// raises CART_ITEM_NOT_FOUND (P0002) if the variant isn't already in the
// cart -- this is deliberately NOT an upsert, so a PATCH against a variant
// that was never added fails closed instead of silently creating a line.
export async function updateNativeCartItemQuantity(input: {
  cartId: string;
  customerId?: string | null;
  guestToken?: string;
  productVariantId: string;
  quantity: bigint;
}): Promise<NativeCartItemRow> {
  if (input.customerId && input.guestToken) throw new Error("NATIVE_CART_OWNER_CONTEXT_INVALID");
  const guestFingerprint = input.guestToken ? hashGuestCartToken(input.guestToken) : null;
  const result = await withPersiRole("persi_app", (db) => db.execute<NativeCartItemRow>(sql`
    select id::text as "id", cart_id::text as "cartId", product_variant_id::text as "productVariantId", quantity
    from public.set_native_cart_item_quantity(${input.cartId}::uuid, ${input.customerId ?? null}::uuid, ${guestFingerprint}::text, ${input.productVariantId}::uuid, ${input.quantity}::bigint)
  `));
  return result[0];
}

// Gate 3 -- returns whether a line was actually removed (remove_native_cart_item's
// own boolean contract). Removing a variant that was never in the cart is
// NOT an error -- it returns false, matching a DELETE's usual idempotent
// semantics (calling it twice has the same end state).
export async function removeNativeCartItem(input: {
  cartId: string;
  customerId?: string | null;
  guestToken?: string;
  productVariantId: string;
}): Promise<boolean> {
  if (input.customerId && input.guestToken) throw new Error("NATIVE_CART_OWNER_CONTEXT_INVALID");
  const guestFingerprint = input.guestToken ? hashGuestCartToken(input.guestToken) : null;
  const result = await withPersiRole("persi_app", (db) => db.execute<{ removed: boolean }>(sql`
    select public.remove_native_cart_item(${input.cartId}::uuid, ${input.customerId ?? null}::uuid, ${guestFingerprint}::text, ${input.productVariantId}::uuid) as removed
  `));
  return result[0].removed;
}

export interface NativeCartReadModel {
  [key: string]: unknown;
  id: string;
  storeId: string;
  customerId: string | null;
  guestTokenFingerprint: string | null;
  currency: string;
  status: string;
  version: bigint;
  items: Array<{ id: string; productVariantId: string; quantity: bigint }>;
}

// Gate 3 -- plain read via persi_app's own table-level SELECT grant on
// carts/cart_items (supabase/migrations/20260905180000_native_checkout_atomic_submission.sql:169)
// -- there is no dedicated read function for carts (unlike readNativeOrder/
// readNativeCheckout, which read through their own tables the same way).
// Ownership is NOT checked here -- callers MUST call canAccessNativeCart
// (already exported by this module) against the result before returning
// anything to a client, exactly like every route in this file already
// does its own authorization check against the SQL function's own
// CART_OWNERSHIP_INVALID error for writes.
export async function readNativeCartById(cartId: string): Promise<NativeCartReadModel | null> {
  const result = await withPersiRole("persi_app", (db) => db.execute<NativeCartReadModel>(sql`
    select c.id::text as "id", c.store_id::text as "storeId", c.customer_id::text as "customerId",
      c.guest_token_fingerprint as "guestTokenFingerprint", c.currency, c.status, c.version,
      coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'productVariantId',i.product_variant_id,'quantity',i.quantity) order by i.created_at)
        from public.cart_items i where i.cart_id=c.id),'[]') as items
    from public.carts c where c.id=${cartId}::uuid
  `));
  return result[0] ?? null;
}

// Gate 3 -- finds the caller's own ACTIVE cart without creating one (GET
// must never create state -- see docs/native-commerce/gate3-native-cart-checkout-routes.md).
// Guest lookup is by fingerprint alone (carts_guest_token_unique is a
// global unique index, not scoped by store/currency); customer lookup is
// scoped by (store, currency) matching carts_active_customer_unique.
export async function findActiveNativeCart(input: {
  storeId: string;
  currency: string;
  customerId?: string | null;
  guestToken?: string;
}): Promise<NativeCartReadModel | null> {
  if (input.customerId && input.guestToken) throw new Error("NATIVE_CART_OWNER_CONTEXT_INVALID");
  if (input.guestToken) {
    const guestFingerprint = hashGuestCartToken(input.guestToken);
    const result = await withPersiRole("persi_app", (db) => db.execute<{ id: string }>(sql`
      select id::text as "id" from public.carts where guest_token_fingerprint=${guestFingerprint}::text and status='active'
    `));
    return result[0] ? readNativeCartById(result[0].id) : null;
  }
  if (input.customerId) {
    const result = await withPersiRole("persi_app", (db) => db.execute<{ id: string }>(sql`
      select id::text as "id" from public.carts
      where store_id=${input.storeId}::uuid and customer_id=${input.customerId}::uuid
        and currency=${input.currency}::char(3) and status='active'
    `));
    return result[0] ? readNativeCartById(result[0].id) : null;
  }
  return null;
}
