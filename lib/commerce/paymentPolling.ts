/**
 * Pagamento "em processamento": a tentativa ficou em PAYMENT_CREATING e o
 * servidor respondeu 409 ("em reconciliação" ou "já está sendo processado").
 *
 * Nesse estado o resultado é INCERTO: o banco pode ter criado a cobrança. Por
 * isso o checkout NÃO gera chave nova e NÃO oferece outro pagamento (risco de
 * cobrança dupla). Ele só consulta, a cada 5 s e por até 2 minutos, o estado
 * da MESMA chave (`GET /api/checkout/payment/attempt`, só leitura) e age quando
 * ela se resolve:
 *
 *   created   → a cobrança existe: segue para a página do pedido;
 *   declined  → falha definitiva: aplica o fluxo da recusa (chave nova + Pix);
 *   timeout   → 2 min sem resposta: mensagem final, sem liberar novo pagamento.
 *
 * Código puro, sem dependências: o relógio e a consulta entram de fora.
 */

export const PAYMENT_POLL_INTERVAL_MS = 5_000;
export const PAYMENT_POLL_TIMEOUT_MS = 2 * 60 * 1000;

export const PAYMENT_PROCESSING_MESSAGE =
  "Estamos confirmando seu pagamento com o banco. Não feche esta página.";
export const PAYMENT_TIMEOUT_MESSAGE =
  "Ainda não recebemos a confirmação do banco. Você receberá a confirmação por e-mail. Se preferir, fale com a gente no WhatsApp.";

/** Os dois 409 de "ainda processando": reconciliação (PAYMENT_CREATING) e tentativa já em andamento. */
export function isPaymentInProgress(outcome: { status?: number; code?: string }): boolean {
  return (
    outcome.status === 409 &&
    (outcome.code === "PAYMENT_IN_PROGRESS" || outcome.code === "CHECKOUT_IN_PROGRESS")
  );
}

export type AttemptOutcome = "processing" | "created" | "declined" | "not_found";

export interface AttemptSnapshot {
  state: string;
  provider_reference: string | null;
  payment_method: string;
}

/**
 * Lê a tentativa guardada e diz em que pé está. `cardDeclined` é o resultado
 * da consulta (só leitura) ao gateway do cartão: `true` recusado, `false` não
 * recusado, `null` quando não foi possível consultar.
 *
 * `orderStatus` é o status do pedido no WooCommerce. A rotina do servidor que
 * resolve tentativas travadas (services/payments/stuckPayments.ts) não consegue
 * mexer na tentativa guardada no plugin, só no pedido: pedido pago vira "created",
 * pedido falho ou cancelado vira "declined", mesmo sem a cobrança guardada.
 */
export function resolveAttemptOutcome(
  attempt: AttemptSnapshot,
  cardDeclined: boolean | null,
  orderStatus?: string,
): AttemptOutcome {
  if (attempt.state === "PAYMENT_FAILED") return "declined";
  if (attempt.state === "PAYMENT_CONFIRMED") return "created";
  // Ainda sem cobrança guardada (PAYMENT_CREATING): só o pedido pode dizer algo.
  if (!attempt.provider_reference) {
    if (orderStatus === "processing" || orderStatus === "completed") return "created";
    if (orderStatus === "failed" || orderStatus === "cancelled") return "declined";
    return "processing";
  }
  const isCard =
    attempt.payment_method === "mercadopago_card" || attempt.payment_method.startsWith("pagbank_");
  if (!isCard) return "created";
  if (cardDeclined === true) return "declined";
  if (cardDeclined === false) return "created";
  return "processing";
}

export interface PollCheck {
  outcome: AttemptOutcome;
  confirmationUrl?: string;
}

export type PollResult =
  | { kind: "created"; confirmationUrl: string }
  | { kind: "declined" }
  | { kind: "not_found" }
  | { kind: "timeout" }
  | { kind: "cancelled" };

/**
 * Consulta de tempos em tempos até a tentativa se resolver ou o tempo acabar.
 * Erro de rede, 401, 429 e qualquer resposta torta contam como "ainda
 * processando": a chave nunca muda aqui. "Não encontrada" (a tentativa nunca
 * existiu) só encerra a espera quando `stopOnNotFound` está ligado, o que vale
 * ao RETOMAR uma chave guardada depois de recarregar a página; no pagamento
 * em andamento ela conta como "ainda processando".
 */
export async function pollPaymentAttempt(options: {
  check: () => Promise<PollCheck | null>;
  wait: (ms: number) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
  timeoutMs?: number;
  isCancelled?: () => boolean;
  stopOnNotFound?: boolean;
}): Promise<PollResult> {
  const now = options.now ?? Date.now;
  const intervalMs = options.intervalMs ?? PAYMENT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? PAYMENT_POLL_TIMEOUT_MS;
  const startedAt = now();

  while (now() - startedAt < timeoutMs) {
    if (options.isCancelled?.()) return { kind: "cancelled" };
    let result: PollCheck | null = null;
    try {
      result = await options.check();
    } catch {
      result = null;
    }
    if (result?.outcome === "declined") return { kind: "declined" };
    if (result?.outcome === "not_found" && options.stopOnNotFound) return { kind: "not_found" };
    if (result?.outcome === "created" && result.confirmationUrl) {
      return { kind: "created", confirmationUrl: result.confirmationUrl };
    }
    await options.wait(intervalMs);
  }
  return options.isCancelled?.() ? { kind: "cancelled" } : { kind: "timeout" };
}
