export type InterHttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export class InterPaymentError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "INTER_PAYMENT_ERROR") {
    super(message);
    this.name = "InterPaymentError";
    this.status = status;
    this.code = code;
  }
}
