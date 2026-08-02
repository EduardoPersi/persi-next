import type { PersiPaymentMethod } from "@/services/woocommerce/orders";

export interface PixPaymentResult {
  method: "inter_pix";
  orderId: number;
  txid: string;
  qrCodeCopyPaste: string;
  qrCodeImageBase64: string;
  expiresAt: string;
}

export interface BoletoPaymentResult {
  method: "inter_boleto";
  orderId: number;
  requestCode: string;
  digitableLine: string;
  barcode: string;
  dueDate: string;
}

export interface CardPaymentResult {
  method: "pagbank_card" | "pagbank_apple_pay" | "pagbank_google_pay";
  orderId: number;
  chargeId: string;
  status: "AUTHORIZED" | "PAID" | "DECLINED" | "IN_ANALYSIS" | "CANCELED";
}

export interface AlreadyInitiatedPaymentResult {
  alreadyInitiated: true;
  method: PersiPaymentMethod;
  orderId: number;
}

export type PaymentInitiationResult =
  | PixPaymentResult
  | BoletoPaymentResult
  | CardPaymentResult
  | AlreadyInitiatedPaymentResult;
