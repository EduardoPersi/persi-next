import QRCode from "qrcode";
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

export type PixChargeStatus =
  | "ATIVA"
  | "CONCLUIDA"
  | "REMOVIDA_PELO_USUARIO_RECEBEDOR"
  | "REMOVIDA_PELO_PSP";

const PIX_EXPIRATION_SECONDS = 3600;

export interface CreatePixChargeInput {
  txid: string;
  amount: number;
  payerDocument: string;
  payerName: string;
  description: string;
}

export interface PixCharge {
  txid: string;
  status: PixChargeStatus;
  qrCodeCopyPaste: string;
  qrCodeImageBase64: string;
  expiresAt: string;
}

interface InterPixCobResponse {
  txid: string;
  status: string;
  calendario: { criacao: string; expiracao: number };
  pixCopiaECola: string;
}

function assertPixChargeStatus(value: string): PixChargeStatus {
  const validStatuses: PixChargeStatus[] = [
    "ATIVA",
    "CONCLUIDA",
    "REMOVIDA_PELO_USUARIO_RECEBEDOR",
    "REMOVIDA_PELO_PSP",
  ];
  if (!validStatuses.includes(value as PixChargeStatus)) {
    throw new InterPaymentError(
      502,
      "Status de cobrança Pix desconhecido",
      "INTER_PIX_UNKNOWN_STATUS",
    );
  }
  return value as PixChargeStatus;
}

function computeExpiresAt(cob: InterPixCobResponse): string {
  const createdAt = new Date(cob.calendario.criacao).getTime();
  if (!Number.isFinite(createdAt)) return new Date().toISOString();
  return new Date(createdAt + cob.calendario.expiracao * 1000).toISOString();
}

// A API Pix (padrão Bacen) não tem um status "EXPIRADA" — uma cobrança que
// venceu sem pagamento continua "ATIVA" para sempre do ponto de vista do
// Inter. Expiração é, portanto, uma determinação nossa, comparando o
// horário atual com `expiresAt`.
export function isPixChargeExpired(charge: {
  status: PixChargeStatus;
  expiresAt: string;
}): boolean {
  return charge.status === "ATIVA" && Date.now() > new Date(charge.expiresAt).getTime();
}

function buildPixDevedor(document: string, name: string): Record<string, string> {
  const digits = document.replace(/\D/g, "");
  return digits.length === 14 ? { cnpj: digits, nome: name } : { cpf: digits, nome: name };
}

export async function createPixCharge(
  input: CreatePixChargeInput,
  request: InterRequestFn = defaultInterRequest,
): Promise<PixCharge> {
  const pixKey = process.env.INTER_PIX_KEY?.trim();
  if (!pixKey) {
    throw new InterPaymentError(
      503,
      "Missing server configuration: INTER_PIX_KEY",
      "INTER_CONFIG_MISSING",
    );
  }

  const cob = await request<InterPixCobResponse>(
    `/pix/v2/cob/${encodeURIComponent(input.txid)}`,
    "PUT",
    {
      calendario: { expiracao: PIX_EXPIRATION_SECONDS },
      devedor: buildPixDevedor(input.payerDocument, input.payerName),
      valor: { original: input.amount.toFixed(2) },
      chave: pixKey,
      solicitacaoPagador: input.description,
    },
  );

  if (!cob.pixCopiaECola) {
    throw new InterPaymentError(
      502,
      "Cobrança Pix criada sem código copia e cola",
      "INTER_PIX_MISSING_COPY_PASTE_CODE",
    );
  }

  // O Inter não expõe um endpoint que devolva a imagem do QR Code pronta —
  // só o código copia e cola (padrão BR Code). A imagem é gerada aqui a
  // partir desse código.
  const qrCodeImageBuffer = await QRCode.toBuffer(cob.pixCopiaECola, {
    type: "png",
    margin: 1,
    width: 440,
  });

  return {
    txid: cob.txid,
    status: assertPixChargeStatus(cob.status),
    qrCodeCopyPaste: cob.pixCopiaECola,
    qrCodeImageBase64: qrCodeImageBuffer.toString("base64"),
    expiresAt: computeExpiresAt(cob),
  };
}

export async function getPixChargeStatus(
  txid: string,
  request: InterRequestFn = defaultInterRequest,
): Promise<Pick<PixCharge, "txid" | "status" | "expiresAt">> {
  const cob = await request<InterPixCobResponse>(
    `/pix/v2/cob/${encodeURIComponent(txid)}`,
    "GET",
  );

  return {
    txid: cob.txid,
    status: assertPixChargeStatus(cob.status),
    expiresAt: computeExpiresAt(cob),
  };
}

export async function getPixCharge(
  txid: string,
  request: InterRequestFn = defaultInterRequest,
): Promise<PixCharge> {
  const cob = await request<InterPixCobResponse>(`/pix/v2/cob/${encodeURIComponent(txid)}`, "GET");
  if (!cob.pixCopiaECola) {
    throw new InterPaymentError(502, "Cobrança Pix sem código copia e cola", "INTER_PIX_MISSING_COPY_PASTE_CODE");
  }
  const qrCodeImageBuffer = await QRCode.toBuffer(cob.pixCopiaECola, { type: "png", margin: 1, width: 440 });
  return {
    txid: cob.txid,
    status: assertPixChargeStatus(cob.status),
    qrCodeCopyPaste: cob.pixCopiaECola,
    qrCodeImageBase64: qrCodeImageBuffer.toString("base64"),
    expiresAt: computeExpiresAt(cob),
  };
}
