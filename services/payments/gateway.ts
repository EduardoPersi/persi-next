import type { CheckoutStoreAddress } from "@/types/checkout";
import { createBoletoCharge, getBoletoChargeStatus, type BoletoCharge } from "./inter/boleto";
import { createPixCharge, getPixCharge, type PixCharge } from "./inter/pix";

export interface PaymentGatewayAdapter {
  createPix(input: { txid: string; amount: number; payerDocument: string; payerName: string; description: string }): Promise<PixCharge>;
  getPix(reference: string): Promise<PixCharge>;
  createBoleto(input: { seuNumero: string; amount: number; payerDocument: string; payerName: string; billingAddress: CheckoutStoreAddress }): Promise<BoletoCharge>;
  getBoleto(reference: string): Promise<BoletoCharge>;
}

export const interPaymentGateway: PaymentGatewayAdapter = {
  createPix: createPixCharge,
  getPix: getPixCharge,
  createBoleto: createBoletoCharge,
  getBoleto: getBoletoChargeStatus,
};
