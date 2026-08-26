import { buildWebhookUrl } from "../appBaseUrl.ts";
import { PagBankPaymentError, type PagBankHttpMethod } from "./errors.ts";

const PAGBANK_WEBHOOK_PATH = "/api/webhooks/pagbank";

export type CardChargeStatus =
  | "AUTHORIZED"
  | "PAID"
  | "DECLINED"
  | "IN_ANALYSIS"
  | "CANCELED";

export type CardPaymentMethod =
  | "credit_card"
  | "debit_card"
  | "apple_pay"
  | "google_pay";

export interface CreateCardChargeInput {
  referenceId: string;
  amount: number;
  cardToken: string;
  installments: number;
  paymentMethod: CardPaymentMethod;
  holderDocument: string;
  holderName: string;
  holderEmail: string;
}

export interface CardChargeResult {
  chargeId: string;
  status: CardChargeStatus;
  amount: number;
  brand?: string;
  lastDigits?: string;
  installments?: number;
}

interface PagBankChargeResponse {
  id: string;
  status: string;
  amount: { value: number };
  payment_method?: {
    installments?: number;
    card?: {
      brand?: string;
      last_digits?: string;
    };
  };
}

interface PagBankOrderResponse {
  charges: PagBankChargeResponse[];
}

type PagBankRequestFn = <T>(
  path: string,
  method: PagBankHttpMethod,
  body?: Record<string, unknown>,
) => Promise<T>;

// Import dinâmico: `client.ts` importa "server-only" (o Bearer token do
// PagBank nunca pode rodar fora de um contexto de servidor) e por isso não
// pode ser carregado estaticamente por quem só quer usar as funções puras
// deste arquivo (ex.: testes). Só é resolvido quando nenhum `request` é
// injetado pelo chamador.
const defaultPagBankRequest: PagBankRequestFn = async (path, method, body) => {
  const { pagbankRequest } = await import("./client.ts");
  return pagbankRequest(path, method, body);
};

const VALID_CHARGE_STATUSES: CardChargeStatus[] = [
  "AUTHORIZED",
  "PAID",
  "DECLINED",
  "IN_ANALYSIS",
  "CANCELED",
];

function assertChargeStatus(value: string): CardChargeStatus {
  if (!VALID_CHARGE_STATUSES.includes(value as CardChargeStatus)) {
    throw new PagBankPaymentError(
      502,
      "Status de cobrança do PagBank desconhecido",
      "PAGBANK_UNKNOWN_STATUS",
    );
  }
  return value as CardChargeStatus;
}

function toChargeResult(charge: PagBankChargeResponse): CardChargeResult {
  return {
    chargeId: charge.id,
    status: assertChargeStatus(charge.status),
    amount: charge.amount.value / 100,
    brand: charge.payment_method?.card?.brand,
    lastDigits: charge.payment_method?.card?.last_digits,
    installments: charge.payment_method?.installments,
  };
}

const PAGBANK_PAYMENT_METHOD_TYPE: Record<CardPaymentMethod, string> = {
  credit_card: "CREDIT_CARD",
  debit_card: "DEBIT_CARD",
  apple_pay: "APPLE_PAY",
  google_pay: "GOOGLE_PAY",
};

export async function createCardCharge(
  input: CreateCardChargeInput,
  request: PagBankRequestFn = defaultPagBankRequest,
): Promise<CardChargeResult> {
  const order = await request<PagBankOrderResponse>("/orders", "POST", {
    reference_id: input.referenceId,
    customer: {
      name: input.holderName,
      email: input.holderEmail,
      tax_id: input.holderDocument.replace(/\D/g, ""),
    },
    notification_urls: [buildWebhookUrl(PAGBANK_WEBHOOK_PATH)],
    items: [
      {
        reference_id: input.referenceId,
        name: `Pedido ${input.referenceId}`,
        quantity: 1,
        unit_amount: Math.round(input.amount * 100),
      },
    ],
    charges: [
      {
        amount: { value: Math.round(input.amount * 100), currency: "BRL" },
        payment_method: {
          type: PAGBANK_PAYMENT_METHOD_TYPE[input.paymentMethod],
          installments: input.installments,
          capture: true,
          card: { encrypted: input.cardToken },
        },
      },
    ],
  });

  const [charge] = order.charges;
  if (!charge) {
    throw new PagBankPaymentError(
      502,
      "Resposta de cobrança do PagBank inválida",
      "PAGBANK_INVALID_RESPONSE",
    );
  }

  return toChargeResult(charge);
}

export async function getCardChargeStatus(
  chargeId: string,
  request: PagBankRequestFn = defaultPagBankRequest,
): Promise<CardChargeResult> {
  const charge = await request<PagBankChargeResponse>(
    `/charges/${encodeURIComponent(chargeId)}`,
    "GET",
  );

  return toChargeResult(charge);
}
