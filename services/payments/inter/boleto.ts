import type { CheckoutStoreAddress } from "@/types/checkout";
import { InterPaymentError, type InterHttpMethod } from "./errors.ts";

type InterRequestFn = <T>(
  path: string,
  method: InterHttpMethod,
  body?: Record<string, unknown>,
) => Promise<T>;

// Import dinâmico: `client.ts` importa "server-only" e não pode ser
// carregado estaticamente por quem só quer usar as funções puras deste
// arquivo (ex.: testes). Só é resolvido de fato quando nenhum `request`
// é injetado pelo chamador.
const defaultInterRequest: InterRequestFn = async (path, method, body) => {
  const { interRequest } = await import("./client.ts");
  return interRequest(path, method, body);
};

export type BoletoChargeStatus =
  | "EM_PROCESSAMENTO"
  | "A_RECEBER"
  | "MARCADO_RECEBIDO"
  | "ATRASADO"
  | "CANCELADO"
  | "EXPIRADO"
  | "FALHA_EMISSAO";

const BOLETO_DUE_DAYS = 2;

// Único ponto de verdade do prazo de vencimento do boleto (D+2 corridos a
// partir de agora) — usado na criação da cobrança e reaproveitado por quem
// precisar exibir "válido até" sem recalcular a data em outro lugar.
export function getBoletoDueDate(referenceDate: Date = new Date()): string {
  const dueDate = new Date(referenceDate.getTime() + BOLETO_DUE_DAYS * 24 * 60 * 60 * 1000);
  return dueDate.toISOString().slice(0, 10);
}

export interface CreateBoletoInput {
  seuNumero: string;
  amount: number;
  payerDocument: string;
  payerName: string;
  billingAddress: CheckoutStoreAddress;
}

export interface BoletoCharge {
  requestCode: string;
  status: BoletoChargeStatus;
  digitableLine: string;
  barcode: string;
  dueDate: string;
}

interface InterBoletoCreateResponse {
  codigoSolicitacao: string;
}

interface InterBoletoDetailResponse {
  codigoSolicitacao: string;
  situacao: string;
  dataVencimento?: string;
  boleto?: { linhaDigitavel: string; codigoBarras: string };
}

const VALID_BOLETO_STATUSES: BoletoChargeStatus[] = [
  "EM_PROCESSAMENTO",
  "A_RECEBER",
  "MARCADO_RECEBIDO",
  "ATRASADO",
  "CANCELADO",
  "EXPIRADO",
  "FALHA_EMISSAO",
];

function assertBoletoStatus(value: string): BoletoChargeStatus {
  if (!VALID_BOLETO_STATUSES.includes(value as BoletoChargeStatus)) {
    throw new InterPaymentError(
      502,
      "Situação de boleto desconhecida",
      "INTER_BOLETO_UNKNOWN_STATUS",
    );
  }
  return value as BoletoChargeStatus;
}

function buildPagadorDocument(document: string): { cpfCnpj: string; tipoPessoa: "FISICA" | "JURIDICA" } {
  const digits = document.replace(/\D/g, "");
  return {
    cpfCnpj: digits,
    tipoPessoa: digits.length === 14 ? "JURIDICA" : "FISICA",
  };
}

export async function createBoletoCharge(
  input: CreateBoletoInput,
  request: InterRequestFn = defaultInterRequest,
): Promise<BoletoCharge> {
  const dueDate = getBoletoDueDate();

  const created = await request<InterBoletoCreateResponse>(
    "/cobranca/v3/boletos",
    "POST",
    {
      seuNumero: input.seuNumero,
      valorNominal: Number(input.amount.toFixed(2)),
      dataVencimento: dueDate,
      numDiasAgenda: 60,
      pagador: {
        ...buildPagadorDocument(input.payerDocument),
        nome: input.payerName,
        endereco: input.billingAddress.address1,
        cidade: input.billingAddress.city,
        uf: input.billingAddress.state,
        cep: input.billingAddress.postcode,
      },
    },
  );

  if (!created.codigoSolicitacao) {
    throw new InterPaymentError(
      502,
      "Resposta de criação de boleto inválida",
      "INTER_BOLETO_INVALID_RESPONSE",
    );
  }

  return getBoletoChargeStatus(created.codigoSolicitacao, request);
}

export async function getBoletoChargeStatus(
  requestCode: string,
  request: InterRequestFn = defaultInterRequest,
): Promise<BoletoCharge> {
  const detail = await request<InterBoletoDetailResponse>(
    `/cobranca/v3/boletos/${encodeURIComponent(requestCode)}`,
    "GET",
  );

  return {
    requestCode: detail.codigoSolicitacao,
    status: assertBoletoStatus(detail.situacao),
    digitableLine: detail.boleto?.linhaDigitavel ?? "",
    barcode: detail.boleto?.codigoBarras ?? "",
    dueDate: detail.dataVencimento ?? "",
  };
}
