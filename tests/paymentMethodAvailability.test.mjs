import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// paymentMethod.ts importa a regra monetária de "@/lib/commerce/paymentDiscount"
// (alias só resolvido pelo bundler do Next.js) — como outros módulos do
// projeto com import de valor via "@/" (ex.: services/menu/menu.ts,
// services/account/serverSession.ts), não é importado diretamente por
// testes unitários; a cobertura aqui é por inspeção de código-fonte, mesmo
// padrão usado em tests/checkoutUx.test.mjs.
function read(path) {
  return readFileSync(path, "utf8");
}

test("MIN_BOLETO_AMOUNT é o único mínimo configurado hoje (Pix e cartão continuam sem mínimo)", () => {
  const source = read("components/Checkout/paymentMethod.ts");
  assert.match(source, /export const MIN_BOLETO_AMOUNT = 2\.5;/);
  const rulesBlock = source.match(
    /const MIN_AMOUNT_BY_METHOD[^{]*\{([\s\S]*?)\};/,
  );
  assert.ok(rulesBlock, "MIN_AMOUNT_BY_METHOD não encontrado");
  assert.match(rulesBlock[1], /inter_boleto:\s*MIN_BOLETO_AMOUNT/);
  assert.doesNotMatch(rulesBlock[1], /inter_pix:/);
  assert.doesNotMatch(rulesBlock[1], /mercadopago_card:/);
});

test("isPaymentMethodAvailable nunca esconde uma opção antes do total do carrinho ser conhecido", () => {
  const source = read("components/Checkout/paymentMethod.ts");
  assert.match(
    source,
    /if \(!minAmount \|\| typeof cartTotal !== "number"\) return true;/,
  );
});

test("PaymentMethodSelector filtra as opções pela disponibilidade antes de renderizar", () => {
  const source = read("components/Checkout/PaymentMethodSelector.tsx");
  assert.match(
    source,
    /allOptions\.filter\(\(option\) =>\s*isPaymentMethodAvailable\(option\.value, cartTotal, discountBase\),?\s*\)/,
  );
});

test("CheckoutPayment troca para Pix automaticamente quando o método selecionado deixa de ser válido", () => {
  const source = read("components/Checkout/CheckoutPayment.tsx");
  assert.match(source, /if \(!isPaymentMethodAvailable\(method, cartTotal, discountBase\)\)/);
  assert.match(source, /onMethodChange\("inter_pix"\)/);
});

test("rota de pagamento importa o mesmo MIN_BOLETO_AMOUNT do seletor (fonte única do mínimo)", () => {
  const source = read("app/api/checkout/payment/route.ts");
  assert.match(
    source,
    /import\s*\{[^}]*MIN_BOLETO_AMOUNT[^}]*\}\s*from\s*"@\/components\/Checkout\/paymentMethod"/,
  );
  assert.doesNotMatch(source, /const MIN_BOLETO_AMOUNT = 2\.5/);
});
