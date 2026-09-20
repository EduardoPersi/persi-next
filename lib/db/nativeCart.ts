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
