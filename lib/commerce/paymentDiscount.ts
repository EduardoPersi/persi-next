export const PIX_DISCOUNT_RATE = 0.1;
export const BOLETO_DISCOUNT_RATE = 0.05;

export type DiscountablePaymentMethod =
  | "inter_pix"
  | "inter_boleto"
  | "mercadopago_card"
  | "pagbank_apple_pay"
  | "pagbank_google_pay";

export interface PaymentTotalsInput {
  method: DiscountablePaymentMethod;
  productsSubtotal: number;
  existingDiscounts: number;
  orderTotal: number;
  minorUnit?: number;
}

export interface PaymentTotals {
  discountBase: number;
  paymentDiscount: number;
  finalTotal: number;
}

function roundMoney(value: number, minorUnit: number): number {
  const safeMinorUnit = Number.isInteger(minorUnit)
    ? Math.min(Math.max(minorUnit, 0), 6)
    : 2;
  const factor = 10 ** safeMinorUnit;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function getPaymentDiscountRate(
  method: DiscountablePaymentMethod,
): number {
  if (method === "inter_pix") return PIX_DISCOUNT_RATE;
  if (method === "inter_boleto") return BOLETO_DISCOUNT_RATE;
  return 0;
}

/**
 * Aplica o desconto da forma de pagamento somente sobre os produtos depois
 * dos descontos existentes. Frete, taxas, impostos e serviços permanecem
 * integralmente no total do pedido.
 */
export function calculatePaymentTotals({
  method,
  productsSubtotal,
  existingDiscounts,
  orderTotal,
  minorUnit = 2,
}: PaymentTotalsInput): PaymentTotals {
  const safeProductsSubtotal = Number.isFinite(productsSubtotal)
    ? Math.max(0, productsSubtotal)
    : 0;
  const safeExistingDiscounts = Number.isFinite(existingDiscounts)
    ? Math.max(0, existingDiscounts)
    : 0;
  const safeOrderTotal = Number.isFinite(orderTotal) ? Math.max(0, orderTotal) : 0;
  const discountBase = roundMoney(
    Math.max(0, safeProductsSubtotal - safeExistingDiscounts),
    minorUnit,
  );
  const paymentDiscount = roundMoney(
    discountBase * getPaymentDiscountRate(method),
    minorUnit,
  );

  return {
    discountBase,
    paymentDiscount,
    finalTotal: roundMoney(
      Math.max(0, safeOrderTotal - paymentDiscount),
      minorUnit,
    ),
  };
}
