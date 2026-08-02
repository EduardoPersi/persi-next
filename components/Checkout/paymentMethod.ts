export type CheckoutPaymentMethod =
  | "inter_pix"
  | "inter_boleto"
  | "pagbank_card"
  | "pagbank_apple_pay"
  | "pagbank_google_pay";

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}
