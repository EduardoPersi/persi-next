export type PagBankHttpMethod = "GET" | "POST" | "PUT";

export class PagBankPaymentError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "PAGBANK_PAYMENT_ERROR") {
    super(message);
    this.name = "PagBankPaymentError";
    this.status = status;
    this.code = code;
  }
}
