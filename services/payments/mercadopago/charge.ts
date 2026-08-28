import { detectBrazilianDocumentType } from "@/lib/validation/document.ts";
import { buildWebhookUrl } from "../appBaseUrl.ts";
import { MercadoPagoPaymentError, type MercadoPagoHttpMethod } from "./errors.ts";

const MERCADOPAGO_WEBHOOK_PATH = "/api/webhooks/mercadopago";

export type MercadoPagoChargeStatus =
  | "approved"
  | "authorized"
  | "in_process"
  | "pending"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "charged_back";

export interface CreateCardChargeInput {
  referenceId: string;
  amount: number;
  cardToken: string;
  installments: number;
  paymentMethodId: string;
  issuerId?: string;
  holderDocument: string;
  holderName: string;
  holderEmail: string;
}

export interface CardChargeResult {
  chargeId: string;
  status: MercadoPagoChargeStatus;
  amount: number;
  brand?: string;
  lastDigits?: string;
  installments?: number;
}

interface MercadoPagoPaymentResponse {
  id: number;
  status: string;
  transaction_amount: number;
  payment_method_id?: string;
  installments?: number;
  card?: {
    last_four_digits?: string;
  };
}

type MercadoPagoRequestFn = <T>(
  path: string,
  method: MercadoPagoHttpMethod,
  body?: Record<string, unknown>,
  options?: { idempotencyKey?: string },
) => Promise<T>;

// Import dinâmico: `client.ts` importa "server-only" (o Bearer token do
// Mercado Pago nunca pode rodar fora de um contexto de servidor) e por isso
// não pode ser carregado estaticamente por quem só quer usar as funções
// puras deste arquivo (ex.: testes). Mesmo padrão de services/payments/pagbank/charge.ts.
const defaultMercadoPagoRequest: MercadoPagoRequestFn = async (path, method, body, options) => {
  const { mercadopagoRequest } = await import("./client.ts");
  return mercadopagoRequest(path, method, body, options);
};

const VALID_CHARGE_STATUSES: MercadoPagoChargeStatus[] = [
  "approved",
  "authorized",
  "in_process",
  "pending",
  "rejected",
  "cancelled",
  "refunded",
  "charged_back",
];

function assertChargeStatus(value: string): MercadoPagoChargeStatus {
  if (!VALID_CHARGE_STATUSES.includes(value as MercadoPagoChargeStatus)) {
    throw new MercadoPagoPaymentError(
      502,
      "Status de cobrança do Mercado Pago desconhecido",
      "MERCADOPAGO_UNKNOWN_STATUS",
    );
  }
  return value as MercadoPagoChargeStatus;
}

function toChargeResult(payment: MercadoPagoPaymentResponse): CardChargeResult {
  return {
    chargeId: String(payment.id),
    status: assertChargeStatus(payment.status),
    amount: payment.transaction_amount,
    brand: payment.payment_method_id,
    lastDigits: payment.card?.last_four_digits,
    installments: payment.installments,
  };
}

export async function createCardCharge(
  input: CreateCardChargeInput,
  idempotencyKey: string,
  request: MercadoPagoRequestFn = defaultMercadoPagoRequest,
): Promise<CardChargeResult> {
  const documentType = detectBrazilianDocumentType(input.holderDocument);
  if (!documentType) {
    throw new MercadoPagoPaymentError(
      422,
      "Documento do titular do cartão inválido",
      "MERCADOPAGO_INVALID_DOCUMENT",
    );
  }

  const payment = await request<MercadoPagoPaymentResponse>(
    "/v1/payments",
    "POST",
    {
      transaction_amount: input.amount,
      token: input.cardToken,
      description: `Pedido ${input.referenceId}`,
      installments: input.installments,
      payment_method_id: input.paymentMethodId,
      ...(input.issuerId ? { issuer_id: input.issuerId } : {}),
      capture: true,
      external_reference: input.referenceId,
      notification_url: buildWebhookUrl(MERCADOPAGO_WEBHOOK_PATH),
      payer: {
        email: input.holderEmail,
        identification: {
          type: documentType === "cpf" ? "CPF" : "CNPJ",
          number: input.holderDocument.replace(/\D/g, ""),
        },
      },
    },
    { idempotencyKey },
  );

  return toChargeResult(payment);
}

export async function getCardChargeStatus(
  chargeId: string,
  request: MercadoPagoRequestFn = defaultMercadoPagoRequest,
): Promise<CardChargeResult> {
  const payment = await request<MercadoPagoPaymentResponse>(
    `/v1/payments/${encodeURIComponent(chargeId)}`,
    "GET",
  );

  return toChargeResult(payment);
}
