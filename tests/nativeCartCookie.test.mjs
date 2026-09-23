import assert from "node:assert/strict";
import test from "node:test";
import {
  NATIVE_CART_COOKIE_MAX_AGE_SECONDS,
  NATIVE_CART_COOKIE_NAME,
  nativeCartCookieOptions,
} from "../lib/commerce/nativeCartCookie.ts";

// app/api/cart/cart-response.ts (the legacy WooCommerce cart cookie's own
// module) imports "next/server", so it can't be imported directly from a
// plain-Node test file (this codebase's established convention) -- its
// cookie name (CART_TOKEN_COOKIE = "persi_cart_token") is compared here as
// a literal instead.
const LEGACY_WOO_CART_COOKIE_NAME = "persi_cart_token";

test("the native cart cookie has its own name, distinct from the legacy WooCommerce cart cookie", () => {
  assert.equal(NATIVE_CART_COOKIE_NAME, "persi_native_cart_token");
  assert.notEqual(NATIVE_CART_COOKIE_NAME, LEGACY_WOO_CART_COOKIE_NAME);
});

test("nativeCartCookieOptions is HttpOnly, Secure and SameSite=lax", () => {
  const options = nativeCartCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/");
  assert.equal(options.maxAge, NATIVE_CART_COOKIE_MAX_AGE_SECONDS);
});

test("the cookie max age is 30 days", () => {
  assert.equal(NATIVE_CART_COOKIE_MAX_AGE_SECONDS, 60 * 60 * 24 * 30);
});
