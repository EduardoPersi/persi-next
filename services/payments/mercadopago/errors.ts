export type MercadoPagoHttpMethod = "GET" | "POST" | "PUT";

export class MercadoPagoPaymentError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "MERCADOPAGO_PAYMENT_ERROR") {
    super(message);
    this.name = "MercadoPagoPaymentError";
    this.status = status;
    this.code = code;
  }
}
