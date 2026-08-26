import {
  BOLETO_DISCOUNT_RATE,
  calculatePaymentTotals,
  getPaymentDiscountRate,
} from "@/lib/commerce/paymentDiscount";
import { moneyToNumber } from "@/lib/formatting/money";
import type { Cart } from "@/types/cart";

export type CheckoutPaymentMethod =
  | "inter_pix"
  | "inter_boleto"
  | "pagbank_card"
  | "pagbank_apple_pay"
  | "pagbank_google_pay";

export { BOLETO_DISCOUNT_RATE };

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

// Desconto exclusivo do checkout (não se aplica ao preço exibido na página
// de produto, que mostra o boleto pelo valor cheio).
// Fonte única da regra de desconto por forma de pagamento: usada tanto para
// exibir o valor ao cliente (seletor de pagamento, resumo do pedido) quanto
// para calcular o valor efetivamente cobrado no back-end
// (app/api/checkout/payment/route.ts) — o mesmo valor precisa aparecer nos
// dois lugares.
export function getPaymentMethodDiscountRate(
  method: CheckoutPaymentMethod,
): number {
  return getPaymentDiscountRate(method);
}

export function getCartPaymentTotals(
  method: CheckoutPaymentMethod,
  cart: Cart,
) {
  return calculatePaymentTotals({
    method,
    productsSubtotal: moneyToNumber(cart.totals.items),
    existingDiscounts: moneyToNumber(cart.totals.discount),
    orderTotal: moneyToNumber(cart.totals.price),
    minorUnit: cart.currencyMinorUnit,
  });
}

// Exigência do Banco Inter para emissão de boleto — abaixo disso a API
// rejeita a cobrança (violação "valorNominal deve ser maior ou igual a 2.5").
// Nenhum outro método tem mínimo confirmado hoje.
export const MIN_BOLETO_AMOUNT = 2.5;

// Fonte única de "valor mínimo já com desconto aplicado" por forma de
// pagamento — usada tanto para decidir o que mostrar no seletor (client)
// quanto para validar antes de criar a cobrança (server, ver
// app/api/checkout/payment/route.ts). Novo gateway com mínimo próprio só
// precisa de uma linha aqui.
const MIN_AMOUNT_BY_METHOD: Partial<Record<CheckoutPaymentMethod, number>> = {
  inter_boleto: MIN_BOLETO_AMOUNT,
};

export function getDiscountedAmount(
  method: CheckoutPaymentMethod,
  cartTotal: number,
  discountBase = cartTotal,
): number {
  return calculatePaymentTotals({
    method,
    productsSubtotal: discountBase,
    existingDiscounts: 0,
    orderTotal: cartTotal,
  }).finalTotal;
}

// Sem `cartTotal` conhecido ainda (carrinho carregando), nunca esconde a
// opção — só filtra depois que o valor real está disponível.
export function isPaymentMethodAvailable(
  method: CheckoutPaymentMethod,
  cartTotal: number | undefined,
  discountBase?: number,
): boolean {
  const minAmount = MIN_AMOUNT_BY_METHOD[method];
  if (!minAmount || typeof cartTotal !== "number") return true;
  return getDiscountedAmount(method, cartTotal, discountBase) >= minAmount;
}
