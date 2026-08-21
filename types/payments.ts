import type { PersiPaymentMethod } from "@/services/woocommerce/orders";

export interface PixPaymentResult {
  method: "inter_pix";
  orderId: number;
  amount: number;
  txid: string;
  qrCodeCopyPaste: string;
  qrCodeImageBase64: string;
  expiresAt: string;
  checkoutAttemptId: string;
  confirmationUrl: string;
}

export interface BoletoPaymentResult {
  method: "inter_boleto";
  orderId: number;
  amount: number;
  requestCode: string;
  digitableLine: string;
  barcode: string;
  dueDate: string;
  checkoutAttemptId: string;
  confirmationUrl: string;
}

export interface CardPaymentResult {
  method: "pagbank_card" | "pagbank_apple_pay" | "pagbank_google_pay";
  orderId: number;
  chargeId: string;
  status: "AUTHORIZED" | "PAID" | "DECLINED" | "IN_ANALYSIS" | "CANCELED";
  checkoutAttemptId: string;
  confirmationUrl: string;
}

export interface AlreadyInitiatedPaymentResult {
  alreadyInitiated: true;
  method: PersiPaymentMethod;
  orderId: number;
  checkoutAttemptId: string;
  confirmationUrl: string;
}

export type PaymentInitiationResult =
  | PixPaymentResult
  | BoletoPaymentResult
  | CardPaymentResult
  | AlreadyInitiatedPaymentResult;
