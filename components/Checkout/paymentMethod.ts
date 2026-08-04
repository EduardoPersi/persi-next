import { PIX_DISCOUNT_RATE } from "@/lib/commerce/productPayment";

export type CheckoutPaymentMethod =
  | "inter_pix"
  | "inter_boleto"
  | "pagbank_card"
  | "pagbank_apple_pay"
  | "pagbank_google_pay";

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

// Desconto exclusivo do checkout (não se aplica ao preço exibido na página
// de produto, que mostra o boleto pelo valor cheio).
export const BOLETO_DISCOUNT_RATE = 0.05;

// Fonte única da regra de desconto por forma de pagamento: usada tanto para
// exibir o valor ao cliente (seletor de pagamento, resumo do pedido) quanto
// para calcular o valor efetivamente cobrado no back-end
// (app/api/checkout/payment/route.ts) — o mesmo valor precisa aparecer nos
// dois lugares.
export function getPaymentMethodDiscountRate(
  method: CheckoutPaymentMethod,
): number {
  if (method === "inter_pix") return PIX_DISCOUNT_RATE;
  if (method === "inter_boleto") return BOLETO_DISCOUNT_RATE;
  return 0;
}
