import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("checkout usa Next como padrão e mantém hybrid somente para rollback manual", () => {
  const config = read("lib/commerce/checkoutConfig.ts");
  const page = read("app/checkout/page.tsx");
  assert.match(config, /:\s*"next"/);
  assert.match(config, /card: cardEnabled && \(sandboxConfigured \|\| productionApproved\)/);
  assert.match(page, /redirect\("\/checkout\/hybrid"\)/);
  assert.match(page, /<CheckoutPageClient/);
});

test("cartão depende de capability e permanece desativado no exemplo", () => {
  const selector = read("components/Checkout/PaymentMethodSelector.tsx");
  const env = read(".env.example");
  assert.match(selector, /capabilities\.card/);
  assert.match(env, /CHECKOUT_CARD_ENABLED=false/);
  assert.match(read("lib/commerce/checkoutConfig.ts"), /CHECKOUT_CARD_PRODUCTION_APPROVED/);
});

test("cupom é aplicado e removido exclusivamente pela Store API", () => {
  const service = read("services/woocommerce/cart.ts");
  const route = read("app/api/cart/coupons/route.ts");
  assert.match(service, /cart\/apply-coupon/);
  assert.match(service, /cart\/remove-coupon/);
  assert.match(route, /createCartResponse/);
  assert.match(route, /dynamic = "force-dynamic"/);
});

test("pedido recebe cupons autoritativos e cobrança não calcula desconto", () => {
  const payment = read("app/api/checkout/payment/route.ts");
  const order = read("services/woocommerce/orders.ts");
  assert.match(payment, /couponCodes: cart\.coupons\.map/);
  assert.match(payment, /const amount = cartAmount/);
  assert.match(payment, /ORDER_TOTAL_MISMATCH/);
  assert.doesNotMatch(payment, /cartAmount - discountAmount/);
  assert.match(order, /coupon_lines/);
});

test("Cart-Token não é apagado quando a cobrança é criada", () => {
  const payment = read("app/api/checkout/payment/route.ts");
  assert.match(payment, /return createPrivateResponse\(result, 201, activeCartToken\)/);
  assert.doesNotMatch(payment, /createPrivateResponse\(result, 201, activeCartToken, \{ clearCartToken: true \}\)/);
});

test("tentativa é estável no cliente durante retry e duplo clique", () => {
  const form = read("components/Checkout/CheckoutForm.tsx");
  assert.match(form, /checkoutAttemptIdRef = useRef\(createIdempotencyKey\(\)\)/);
  assert.match(form, /disabled=\{isCheckoutUpdating \|\| isSubmittingPayment\}/);
});
