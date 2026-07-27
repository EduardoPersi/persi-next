import assert from "node:assert/strict";
import test from "node:test";
import {
  CART_CACHE_CONTROL,
  getCartTokenCookieOptions,
  getPrivateCartHeaders,
} from "../lib/commerce/cartResponsePolicy.ts";

test("toda resposta do carrinho usa política privada e sem cache", () => {
  assert.deepEqual(getPrivateCartHeaders(), {
    "Cache-Control": CART_CACHE_CONTROL,
    Pragma: "no-cache",
    Expires: "0",
    Vary: "Cookie",
  });
  assert.match(CART_CACHE_CONTROL, /\bprivate\b/);
  assert.match(CART_CACHE_CONTROL, /\bno-store\b/);
});

test("Cart-Token é persistido em cookie protegido", () => {
  assert.deepEqual(getCartTokenCookieOptions(true), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 2_592_000,
  });
});
