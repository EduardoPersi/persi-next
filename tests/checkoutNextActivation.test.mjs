import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("ambiente de referência ativa Next, Pix e boleto e desativa cartão", () => {
  const env = read(".env.example");
  assert.match(env, /^CHECKOUT_MODE=next$/m);
  assert.match(env, /^CHECKOUT_PIX_ENABLED=true$/m);
  assert.match(env, /^CHECKOUT_BOLETO_ENABLED=true$/m);
  assert.match(env, /^CHECKOUT_CARD_ENABLED=false$/m);
});

test("CTAs públicos navegam para /checkout sem chamar transferência", () => {
  const hook = read("hooks/useCheckoutTransfer.ts");
  assert.match(hook, /window\.location\.assign\("\/checkout"\)/);
  assert.doesNotMatch(hook, /requestCheckoutTransfer/);
  for (const path of ["components/Cart/CartPage.tsx", "components/Header/MiniCart.tsx"]) {
    assert.doesNotMatch(read(path), /checkout-transfer|checkout\/hybrid/);
  }
});

test("frete obrigatório bloqueia pagamento e não exibe zero sem seleção", () => {
  const form = read("components/Checkout/CheckoutForm.tsx");
  const shipping = read("components/Checkout/CheckoutShippingPlaceholder.tsx");
  const summary = read("components/Checkout/CheckoutOrderSummary.tsx");
  assert.match(form, /shippingPackage\.rates\.some\(\(rate\) => rate\.selected\)/);
  assert.match(shipping, /Não encontramos uma opção de entrega para este endereço\./);
  assert.match(summary, /hasSelectedShippingRate/);
});

test("confirmação persiste tentativa na URL e recupera dados no servidor", () => {
  const form = read("components/Checkout/CheckoutForm.tsx");
  const confirmation = read("app/checkout/confirmacao/page.tsx");
  assert.match(form, /\/checkout\/confirmacao\?attempt=/);
  assert.match(confirmation, /getCheckoutAttempt/);
  assert.match(confirmation, /getPixCharge\(/);
  assert.match(confirmation, /getBoletoChargeStatus/);
});

test("teste de staging interrompe antes do gateway e exige um pedido", () => {
  const route = read("app/api/checkout/payment/route.ts");
  const script = read("scripts/checkout-staging-concurrency.mjs");
  assert.match(route, /STAGING_STOPPED_BEFORE_GATEWAY/);
  assert.match(script, /length: 20/);
  assert.match(script, /created\.length !== 1 \|\| orderIds\.length !== 1/);
});
