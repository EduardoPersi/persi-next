/**
 * Rede de segurança dos pagamentos: tentativas travadas e pedidos "Aguardando
 * pagamento" que o webhook não resolveu. Chamada de 10 em 10 minutos pelo cron.
 *
 * FAIXA A, tentativas travadas em PAYMENT_CREATING (pedido pendente SEM cobrança
 * guardada, de 3 min a 24 h). Quando um envio de pagamento morre depois de o
 * checkout marcar PAYMENT_CREATING e antes de gravar a cobrança, ninguém mais
 * resolve. Pergunta ao gateway, SÓ PARA LER, se existe cobrança para o pedido:
 *   achou e está paga       → marca pago (mesmo caminho do webhook);
 *   achou e foi recusada    → cartão: marca falho (definitivo);
 *   achou e ainda pendente  → só guarda a referência no pedido;
 *   achou e Pix expirado    → guarda a referência e só registra no log;
 *   não achou há 30 min+    → o pedido vira falho (nenhuma cobrança foi criada);
 *   não achou há menos      → espera a próxima passada.
 *
 * FAIXA B, pedidos pendentes COM cobrança guardada (Pix, boleto e cartão), de 3
 * min a 5 dias (o boleto pode ser pago dias depois). Reconsulta a cobrança pelo
 * id e, se o gateway disser que está paga, marca pago. Nada além disso: Pix
 * expirado, boleto vencido e cartão recusado só vão ao log; quem cancela é o fluxo
 * que já existe (cron de pendentes).
 *
 * Cadência (o cron chama de 10 em 10 min): pedidos de até 24 h entram em toda
 * passada; os de 1 a 5 dias, só na primeira passada de cada hora.
 *
 * "Pago" tem uma regra só, em todo o site: status aprovado/capturado, valor da
 * compra igual ao total do pedido ao centavo, moeda BRL (ver chargeEvaluation.ts).
 * Se não conferir, NÃO marca pago e registra o motivo.
 *
 * NUNCA cria, estorna nem repete cobrança: só leituras no gateway e atualização de
 * estado do nosso lado. Qualquer dúvida deixa o pedido como está. O log traz só
 * número do pedido, gateway e resultado: nada de dado pessoal.
 *
 * Código com dependências injetadas: a regra inteira é testável sem rede.
 */

import type { WooCommerceOrder } from "../woocommerce/orders.ts";
import type { ChargeEvaluation } from "./chargeEvaluation.ts";

export const STUCK_MIN_AGE_MS = 3 * 60 * 1000;
export const STUCK_GIVE_UP_AGE_MS = 30 * 60 * 1000;
/** Até aqui toda passada confere o pedido (faixa A inteira e a parte "quente" da B). */
export const STUCK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Limite da faixa B: boleto pode ser pago dias depois. */
export const PENDING_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
/** Passada "da hora": o cron roda de 10 em 10 min, então só a primeira de cada hora. */
export const HOURLY_WINDOW_MINUTES = 10;

const IDEMPOTENCY_KEY_META = "_persi_idempotency_key";
const PAYMENT_REFERENCE_META = "_persi_payment_reference";

export type StuckGateway = "mercadopago" | "pagbank" | "inter";

export type StuckProvider = StuckGateway;

/** O que uma consulta de leitura ao gateway devolve, já conferido contra o pedido. */
export interface FoundCharge {
  externalId: string;
  evaluation: ChargeEvaluation;
}

export interface GatewayReaders {
  /** Faixa A. Busca por `external_reference` (número do pedido). `null` = não existe. */
  mercadopago(referenceId: string, order: WooCommerceOrder): Promise<FoundCharge | null>;
  /** Faixa A. Busca por `reference_id` (número do pedido). `null` = não existe. */
  pagbank(referenceId: string, order: WooCommerceOrder): Promise<FoundCharge | null>;
  /** Faixa A. Consulta pelo txid (a chave de idempotência sem os traços). `null` = não existe (404). */
  pix(txid: string, order: WooCommerceOrder): Promise<FoundCharge | null>;
  /** Faixa B. Consulta pelo id da cobrança guardado no pedido, conforme a forma de pagamento. */
  byReference(order: WooCommerceOrder, reference: string): Promise<FoundCharge | null>;
}

export type StuckResult =
  | "paid"
  | "declined"
  | "not_found_failed"
  | "pending"
  /** Pix expirado / boleto vencido / cobrança encerrada: só log, nada é cancelado aqui. */
  | "closed"
  /** O gateway diz "pago", mas valor, moeda ou campo não conferem: não marca pago. */
  | "unverified"
  | "skipped"
  | "error";

export interface StuckLogEntry {
  orderId: number;
  gateway: StuckGateway | "desconhecido";
  band: "A" | "B";
  result: StuckResult;
  /** Motivo da não conferência (`unverified`) ou aviso (`currency_assumed_brl`). */
  reason?: string;
  /** Só `true` na passada de teste (dry-run): nada foi gravado. */
  dryRun?: boolean;
}

export interface StuckDeps {
  /** Estado da tentativa pela chave (só leitura); `null` se a chave nunca existiu. */
  getAttemptState(key: string): Promise<string | null>;
  readers: GatewayReaders;
  /** Mesmo caminho do webhook: guarda a referência (se faltar) e reconcilia como pago. */
  markPaid(order: WooCommerceOrder, provider: StuckProvider, externalId: string): Promise<void>;
  /** Cobrança recusada: guarda a referência e reconcilia como falha. */
  markDeclined(order: WooCommerceOrder, provider: StuckProvider, externalId: string): Promise<void>;
  /** Cobrança achada e ainda pendente: só guarda a referência no pedido. */
  attachReference(order: WooCommerceOrder, provider: StuckProvider, externalId: string): Promise<void>;
  /** Nenhuma cobrança existe: o pedido vira falho. */
  markNotFound(order: WooCommerceOrder): Promise<void>;
  now(): number;
  log(entry: StuckLogEntry): void;
}

function gatewayOf(paymentMethod: string): StuckGateway | null {
  if (paymentMethod === "mercadopago_card") return "mercadopago";
  if (paymentMethod === "pagbank_apple_pay" || paymentMethod === "pagbank_google_pay") return "pagbank";
  if (paymentMethod === "inter_pix" || paymentMethod === "inter_boleto") return "inter";
  return null;
}

function ageOf(order: WooCommerceOrder, nowMs: number): number | null {
  const createdAt = order.createdAtGmt ? Date.parse(order.createdAtGmt) : Number.NaN;
  return Number.isFinite(createdAt) ? nowMs - createdAt : null;
}

/** Faixa A: pendente do checkout, sem cobrança guardada, de 3 min a 24 h. */
export function isStuckCandidate(order: WooCommerceOrder, nowMs: number): boolean {
  if (order.status !== "pending") return false;
  if (!order.metaData[IDEMPOTENCY_KEY_META]) return false;
  if (order.metaData[PAYMENT_REFERENCE_META]) return false;
  const age = ageOf(order, nowMs);
  return age !== null && age > STUCK_MIN_AGE_MS && age < STUCK_MAX_AGE_MS;
}

/** Faixa B: pendente COM cobrança guardada, de 3 min a 5 dias, e já na vez de ser conferido. */
export function isPendingCandidate(order: WooCommerceOrder, nowMs: number, all = false): boolean {
  if (order.status !== "pending") return false;
  if (!order.metaData[PAYMENT_REFERENCE_META]) return false;
  if (!gatewayOf(order.paymentMethod)) return false;
  const age = ageOf(order, nowMs);
  if (age === null || age <= STUCK_MIN_AGE_MS || age >= PENDING_MAX_AGE_MS) return false;
  if (age < STUCK_MAX_AGE_MS || all) return true;
  // De 1 a 5 dias: só na primeira passada de cada hora.
  return new Date(nowMs).getUTCMinutes() < HOURLY_WINDOW_MINUTES;
}

/** Mapeia o resultado da avaliação para a ação da faixa A. */
async function applyBandA(
  order: WooCommerceOrder,
  gateway: StuckGateway,
  found: FoundCharge,
  deps: StuckDeps,
  report: (result: StuckResult, reason?: string) => StuckResult,
): Promise<StuckResult> {
  const { evaluation, externalId } = found;
  if (evaluation.category === "paid") {
    await deps.markPaid(order, gateway, externalId);
    return report("paid", evaluation.currencyAssumed ? "currency_assumed_brl" : undefined);
  }
  if (evaluation.category === "unverified") {
    // Guarda a referência para o pedido não sumir da vista, mas NÃO marca pago.
    await deps.attachReference(order, gateway, externalId);
    return report("unverified", evaluation.reason);
  }
  if (evaluation.category === "failed") {
    await deps.markDeclined(order, gateway, externalId);
    return report("declined");
  }
  // Pendente ou encerrado (Pix expirado): guarda a referência; o cancelamento, se
  // houver, é do cron de pendentes que já existe.
  await deps.attachReference(order, gateway, externalId);
  return report(evaluation.category === "closed" ? "closed" : "pending");
}

export async function reconcileStuckOrder(
  order: WooCommerceOrder,
  deps: StuckDeps,
): Promise<StuckResult> {
  const gateway = gatewayOf(order.paymentMethod);
  const report = (result: StuckResult, reason?: string): StuckResult => {
    deps.log({ orderId: order.id, gateway: gateway ?? "desconhecido", band: "A", result, ...(reason ? { reason } : {}) });
    return result;
  };

  try {
    const key = order.metaData[IDEMPOTENCY_KEY_META];
    // Boleto do Inter: não há leitura por número do pedido sem a referência; fica para a faixa B.
    if (!key || !gateway || order.paymentMethod === "inter_boleto") return report("skipped");

    // Só as tentativas que de fato pararam em PAYMENT_CREATING.
    if ((await deps.getAttemptState(key)) !== "PAYMENT_CREATING") return report("skipped");

    const found =
      gateway === "mercadopago"
        ? await deps.readers.mercadopago(String(order.id), order)
        : gateway === "pagbank"
          ? await deps.readers.pagbank(String(order.id), order)
          : await deps.readers.pix(key.replace(/-/g, ""), order);

    if (found) return await applyBandA(order, gateway, found, deps, report);

    // Nenhuma cobrança no gateway: só desiste depois de 30 minutos.
    const age = ageOf(order, deps.now());
    if (age !== null && age >= STUCK_GIVE_UP_AGE_MS) {
      await deps.markNotFound(order);
      return report("not_found_failed");
    }
    return report("pending");
  } catch {
    // Erro de consulta ou de gravação: nada muda; a próxima passada tenta de novo.
    return report("error");
  }
}

/** Faixa B: só marca pago quando o gateway confirma e tudo confere; o resto é log. */
export async function reconcilePendingOrder(
  order: WooCommerceOrder,
  deps: StuckDeps,
): Promise<StuckResult> {
  const gateway = gatewayOf(order.paymentMethod);
  const report = (result: StuckResult, reason?: string): StuckResult => {
    deps.log({ orderId: order.id, gateway: gateway ?? "desconhecido", band: "B", result, ...(reason ? { reason } : {}) });
    return result;
  };

  try {
    const reference = order.metaData[PAYMENT_REFERENCE_META];
    if (!reference || !gateway) return report("skipped");

    const found = await deps.readers.byReference(order, reference);
    if (!found) return report("pending");

    const { evaluation } = found;
    if (evaluation.category === "paid") {
      await deps.markPaid(order, gateway, found.externalId);
      return report("paid", evaluation.currencyAssumed ? "currency_assumed_brl" : undefined);
    }
    if (evaluation.category === "unverified") return report("unverified", evaluation.reason);
    // Recusado, expirado, vencido ou cancelado: só registra. Cancelar é do fluxo que já existe.
    if (evaluation.category === "failed" || evaluation.category === "closed") return report("closed");
    return report("pending");
  } catch {
    return report("error");
  }
}
