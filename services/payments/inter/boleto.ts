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

// A consulta (GET) devolve os campos de status dentro de "cobranca", não
// soltos na raiz como a criação (POST) devolve "codigoSolicitacao" — são
// dois formatos de resposta diferentes na mesma API.
interface InterBoletoDetailResponse {
  cobranca?: {
    situacao: string;
    dataVencimento?: string;
  };
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

export function buildBoletoChargeRequest(
  input: CreateBoletoInput,
  dueDate: string = getBoletoDueDate(),
) {
  return {
    path: "/cobranca/v3/cobrancas",
    method: "POST" as const,
    body: {
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
        cep: input.billingAddress.postcode.replace(/\D/g, ""),
      },
    },
  };
}

export function getBoletoCreationDiagnostics(input: CreateBoletoInput) {
  const request = buildBoletoChargeRequest(input);
  return {
    path: request.path,
    method: request.method,
    headers: { contentType: "application/json", authorization: "redacted", mtls: true },
    payload: {
      merchantReferenceConfigured: Boolean(input.seuNumero),
      amount: request.body.valorNominal.toFixed(2),
      dueDateConfigured: Boolean(request.body.dataVencimento),
      scheduleDays: request.body.numDiasAgenda,
      payerType: request.body.pagador.tipoPessoa,
      payerNameConfigured: Boolean(request.body.pagador.nome.trim()),
      addressConfigured: Boolean(request.body.pagador.endereco.trim()),
      cityConfigured: Boolean(request.body.pagador.cidade.trim()),
      stateConfigured: /^[A-Za-z]{2}$/.test(request.body.pagador.uf),
      postcodeConfigured: /^\d{8}$/.test(request.body.pagador.cep),
    },
  };
}

// A emissão é assíncrona no Inter: a cobrança nasce "EM_PROCESSAMENTO" e só
// alguns segundos depois passa a ter linha digitável/código de barras. Uma
// única reconsulta logo após o POST (comportamento antigo) frequentemente
// pegava a cobrança ainda em processamento e devolvia esses campos vazios —
// por isso reconsulta algumas vezes, com um pequeno intervalo, antes de
// devolver. Se ainda estiver processando depois disso, devolve mesmo assim
// (o cliente continua consultando via /api/checkout/payment/status).
const BOLETO_STATUS_POLL_ATTEMPTS = 6;
const BOLETO_STATUS_POLL_INTERVAL_MS = 1500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CreateBoletoOptions {
  pollAttempts?: number;
  pollIntervalMs?: number;
}

export async function createBoletoCharge(
  input: CreateBoletoInput,
  request: InterRequestFn = defaultInterRequest,
  options: CreateBoletoOptions = {},
): Promise<BoletoCharge> {
  const dueDate = getBoletoDueDate();
  const pollAttempts = options.pollAttempts ?? BOLETO_STATUS_POLL_ATTEMPTS;
  const pollIntervalMs = options.pollIntervalMs ?? BOLETO_STATUS_POLL_INTERVAL_MS;

  const creationRequest = buildBoletoChargeRequest(input, dueDate);
  const created = await request<InterBoletoCreateResponse>(
    creationRequest.path,
    creationRequest.method,
    creationRequest.body,
  );

  if (!created.codigoSolicitacao) {
    throw new InterPaymentError(
      502,
      "Resposta de criação de boleto inválida",
      "INTER_BOLETO_INVALID_RESPONSE",
    );
  }

  let charge = await getBoletoChargeStatus(created.codigoSolicitacao, request);
  for (
    let attempt = 0;
    attempt < pollAttempts && charge.status === "EM_PROCESSAMENTO" && !charge.digitableLine;
    attempt++
  ) {
    await delay(pollIntervalMs);
    charge = await getBoletoChargeStatus(created.codigoSolicitacao, request);
  }

  return charge;
}

export async function getBoletoChargeStatus(
  requestCode: string,
  request: InterRequestFn = defaultInterRequest,
): Promise<BoletoCharge> {
  const detail = await request<InterBoletoDetailResponse>(
    `/cobranca/v3/cobrancas/${encodeURIComponent(requestCode)}`,
    "GET",
  );

  return {
    requestCode,
    status: assertBoletoStatus(detail.cobranca?.situacao ?? ""),
    digitableLine: detail.boleto?.linhaDigitavel ?? "",
    barcode: detail.boleto?.codigoBarras ?? "",
    dueDate: detail.cobranca?.dataVencimento ?? "",
  };
}

interface InterBoletoPdfResponse {
  pdf?: string;
}

// Só pode ser buscado depois que a cobrança sai de "EM_PROCESSAMENTO" (ver
// createBoletoCharge) — antes disso o Inter ainda não tem o PDF gerado.
export async function getBoletoPdfBase64(
  requestCode: string,
  request: InterRequestFn = defaultInterRequest,
): Promise<string> {
  const detail = await request<InterBoletoPdfResponse>(
    `/cobranca/v3/cobrancas/${encodeURIComponent(requestCode)}/pdf`,
    "GET",
  );

  if (!detail.pdf) {
    throw new InterPaymentError(
      502,
      "PDF do boleto indisponível",
      "INTER_BOLETO_PDF_UNAVAILABLE",
    );
  }

  return detail.pdf;
}
