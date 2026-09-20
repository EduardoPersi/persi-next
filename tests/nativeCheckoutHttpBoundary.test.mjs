import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Static source-inspection tests, matching this codebase's own established
// convention for Next.js Route Handlers (tests/checkoutPaymentHealth.test.mjs
// does the same, for the same reason): importing a route file that pulls in
// "next/server" fails under the plain Node test runner outside Next's own
// bundler (`next/server`'s package export map isn't resolvable by Node's
// loader here -- ERR_MODULE_NOT_FOUND), so a live `POST(new Request(...))`
// call isn't reachable from this test file. These assertions pin the exact
// code shape instead.

const read = (path) => readFileSync(path, "utf8");
const routeSource = read("app/api/checkout/native/route.ts");

// ---------- C7: native runtime OFF ----------
test("C7 the runtime gate rejects every request with 404 while isNativeCheckoutRuntimeEnabled() is false, unconditionally", () => {
  const postBody = routeSource.slice(routeSource.indexOf("export async function POST"));
  const gateBlock = postBody.slice(0, postBody.indexOf("if (exceedsRequestLimit"));
  assert.match(gateBlock, /if \(!isNativeCheckoutRuntimeEnabled\(\)\)/);
  assert.match(gateBlock, /status: 404/);
  assert.match(gateBlock, /NATIVE_CHECKOUT_DISABLED/);
  // The flag itself always returns false regardless of env this round.
  const flagSource = read("lib/runtime/native-checkout-mode.ts");
  assert.match(flagSource, /export function isNativeCheckoutRuntimeEnabled\(\): boolean \{\s*return false;/);
});

// ---------- static source assertions for the remaining properties ----------

test("C1/C2 malformed body and unsupported payment method are rejected by a strict, closed schema", () => {
  assert.match(routeSource, /z\.discriminatedUnion\("method"/);
  for (const method of ["inter_pix", "inter_boleto", "mercadopago_card", "pagbank_apple_pay", "pagbank_google_pay"]) {
    assert.match(routeSource, new RegExp(`z\\.literal\\("${method}"\\)`));
  }
  assert.match(routeSource, /requestSchema[\s\S]*?\.strict\(\)/);
  assert.match(routeSource, /INVALID_REQUEST/);
});

test("C3/C4/C5 no amount, shipping, payment-status or order-status field is ever accepted from the request body", () => {
  const schemaSection = routeSource.slice(routeSource.indexOf("const requestSchema"), routeSource.indexOf("function toNativeOrderAddress"));
  for (const forbidden of [/amount/i, /shipping.*amount/i, /paymentStatus/i, /orderStatus/i, /providerReference/i, /\btotal\b/i]) {
    assert.doesNotMatch(schemaSection, forbidden);
  }
  // The service's own input type derives amount/currency from the
  // just-created native order, never from `input` -- confirmed structurally
  // by nativeCheckoutService.test.mjs; this route adds no second path in.
});

test("C6 owner identity: guestToken is a required bearer credential, customerId can never be supplied by the request", () => {
  assert.match(routeSource, /guestToken: z\.string\(\)\.trim\(\)\.min\(32\)/);
  const schemaSection = routeSource.slice(routeSource.indexOf("const requestSchema"), routeSource.indexOf("function toNativeOrderAddress"));
  assert.doesNotMatch(schemaSection, /customerId/);
  assert.match(routeSource, /customerId: null/);
});

test("C8 provider token is never logged", () => {
  const catchSection = routeSource.slice(routeSource.indexOf("} catch (error) {", routeSource.indexOf("export async function POST")));
  assert.match(catchSection, /logNativeCommerceEvent\("native_checkout_submission_failed"/);
  assert.doesNotMatch(catchSection, /cardToken|payment,|payment:|JSON\.stringify\(error\)/);
});

test("C9 the response DTO is exactly the service's own presentation result, no internal row is spread into it", () => {
  assert.match(routeSource, /NextResponse\.json\(result, \{ status: 201 \}\)/);
  assert.doesNotMatch(routeSource, /piiCiphertext|piiIv|piiAuthTag/);
});

test("C10 replay/idempotency: no route-level dedup bookkeeping is introduced -- reuses submit_native_checkout/create_native_payment_attempt's own proven idempotency", () => {
  assert.doesNotMatch(routeSource, /from "@\/lib\/commerce\/checkoutAttempt"/);
  const interEcConcurrency = read("scripts/database/native-checkout-payment-concurrency.mjs");
  assert.match(interEcConcurrency, /submitNativeCommerceCheckout/);
});

test("fail-closed check runs unconditionally, independent of any request content", () => {
  const postBody = routeSource.slice(routeSource.indexOf("export async function POST"));
  const gateIndex = postBody.indexOf("isNativeCheckoutRuntimeEnabled()");
  const bodyReadIndex = postBody.indexOf("request.json()");
  assert.ok(gateIndex > -1 && bodyReadIndex > -1 && gateIndex < bodyReadIndex, "runtime gate must run before the request body is ever read");
});
