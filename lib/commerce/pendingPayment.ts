/**
 * Chave de pagamento PENDENTE, guardada na `sessionStorage` da aba.
 *
 * Se o cliente recarregar a página durante (ou depois de) uma tentativa cujo
 * resultado ainda é incerto, o checkout nasceria com uma chave nova e liberaria
 * outro pagamento, com risco de cobrança dupla. Por isso, ao enviar um
 * pagamento guardamos a chave em uso, a forma de pagamento e o horário. NADA
 * mais: nem dado de cartão, nem dado pessoal.
 *
 * Ao abrir o checkout com uma chave pendente de menos de 30 minutos, o
 * checkout consulta o estado dela (só leitura) antes de liberar qualquer
 * pagamento. A chave sai da `sessionStorage` quando o desfecho é conhecido:
 * pedido criado (o cliente vai para a página do pedido), pagamento recusado,
 * tentativa que nunca existiu, ou falha que o servidor já confirmou como
 * definitiva. Fica guardada só enquanto o resultado é incerto.
 *
 * Código puro (o armazenamento entra de fora): testável sem navegador.
 */

export const PENDING_PAYMENT_STORAGE_KEY = "checkout_pending_payment_v1";
export const PENDING_PAYMENT_TTL_MS = 30 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODS = new Set([
  "inter_pix",
  "inter_boleto",
  "mercadopago_card",
  "pagbank_apple_pay",
  "pagbank_google_pay",
]);

export interface PendingPayment {
  key: string;
  method: string;
  /** Horário do envio, em milissegundos desde 1970. */
  at: number;
}

export interface PendingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function serializePendingPayment(pending: PendingPayment): string {
  return JSON.stringify({ v: 1, key: pending.key, method: pending.method, at: pending.at });
}

/** Qualquer problema (JSON ruim, formato, chave inválida, vencida ou do futuro) vira `null`. */
export function parsePendingPayment(
  raw: string | null | undefined,
  now: number,
): PendingPayment | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.v !== 1) return null;
  if (typeof data.key !== "string" || !UUID.test(data.key)) return null;
  if (typeof data.method !== "string" || !METHODS.has(data.method)) return null;
  if (typeof data.at !== "number" || !Number.isFinite(data.at)) return null;
  if (data.at > now + 60_000) return null;
  if (now - data.at >= PENDING_PAYMENT_TTL_MS) return null;
  return { key: data.key, method: data.method, at: data.at };
}

/** Lê a chave pendente. Se estiver vencida ou ilegível, já apaga. Nunca lança. */
export function readPendingPayment(
  storage: PendingStorage | null,
  now: number = Date.now(),
): PendingPayment | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PENDING_PAYMENT_STORAGE_KEY);
    if (raw === null) return null;
    const pending = parsePendingPayment(raw, now);
    if (!pending) storage.removeItem(PENDING_PAYMENT_STORAGE_KEY);
    return pending;
  } catch {
    return null;
  }
}

export function writePendingPayment(storage: PendingStorage | null, pending: PendingPayment): void {
  if (!storage) return;
  try {
    storage.setItem(PENDING_PAYMENT_STORAGE_KEY, serializePendingPayment(pending));
  } catch {
    // Sem armazenamento (modo privado, cheio): o pagamento segue como sempre.
  }
}

/** Guarda a chave em uso, a forma de pagamento e o horário de agora. */
export function rememberPendingPayment(
  storage: PendingStorage | null,
  key: string,
  method: string,
): void {
  writePendingPayment(storage, { key, method, at: Date.now() });
}

export function clearPendingPayment(storage: PendingStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(PENDING_PAYMENT_STORAGE_KEY);
  } catch {
    // Nada a apagar.
  }
}

/** A `sessionStorage` do navegador, ou `null` fora dele ou bloqueada. */
export function browserPendingStorage(): PendingStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Depois de uma falha, a chave continua pendente só quando o resultado é
 * INCERTO: sem resposta (erro de rede), erro do servidor (5xx, o banco pode
 * ter cobrado) ou "em processamento" (409). Uma falha que o servidor já
 * confirmou como definitiva (recusa, validação, limite, total diferente)
 * libera a chave: guardar só travaria o cliente à toa na próxima abertura.
 */
export function shouldKeepPendingAfterFailure(outcome: { status?: number; code?: string }): boolean {
  if (outcome.status === undefined) return true;
  if (outcome.status >= 500) return true;
  return (
    outcome.status === 409 &&
    (outcome.code === "PAYMENT_IN_PROGRESS" || outcome.code === "CHECKOUT_IN_PROGRESS")
  );
}
