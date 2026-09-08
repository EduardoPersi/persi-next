import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

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
