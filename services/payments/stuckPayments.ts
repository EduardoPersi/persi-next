/**
 * Tentativas de pagamento TRAVADAS em PAYMENT_CREATING, resolvidas pelo servidor.
 *
 * Quando um envio de pagamento morre depois de o checkout marcar a tentativa como
 * PAYMENT_CREATING e antes de gravar a cobrança (queda do servidor, tempo esgotado
 * no gateway, deploy no meio), ninguém mais resolve: o cliente fica esperando e o
 * pedido fica "pending" para sempre. Esta rotina, chamada de 5 em 5 minutos pelo
 * cron, olha esses pedidos e pergunta ao gateway, SÓ PARA LER, se existe uma
 * cobrança para o número do pedido:
 *
 *   achou e está aprovada   → o pedido vira pago, pelo mesmo caminho do webhook;
 *   achou e está recusada   → o pedido vira falho (falha definitiva);
 *   achou e ainda pendente  → só guarda a referência no pedido: a varredura normal
 *                             (cron de pendentes) e os webhooks passam a enxergá-lo;
 *   não achou há 30 min ou + → o pedido vira falho (nenhuma cobrança foi criada);
 *   não achou há menos       → espera a próxima passada.
 *
 * NUNCA cria, estorna nem repete cobrança: aqui só existem leituras no gateway e
 * atualização de estado do nosso lado. Qualquer dúvida (erro de consulta, gateway
 * sem leitura por número) deixa o pedido como está.
 *
 * Código com dependências injetadas: a regra inteira é testável sem rede.
 */

import type { WooCommerceOrder } from "../woocommerce/orders.ts";

export const STUCK_MIN_AGE_MS = 3 * 60 * 1000;
export const STUCK_GIVE_UP_AGE_MS = 30 * 60 * 1000;
export const STUCK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const IDEMPOTENCY_KEY_META = "_persi_idempotency_key";
const PAYMENT_REFERENCE_META = "_persi_payment_reference";

export type StuckGateway = "mercadopago" | "pagbank" | "inter";

export type StuckProvider = "mercadopago" | "pagbank" | "inter";

/** O que uma consulta de leitura ao gateway devolve, já categorizado. */
export interface FoundCharge {
  externalId: string;
  category: "paid" | "pending" | "failed";
}

export interface GatewayReaders {
  /** Busca por `external_reference` (número do pedido). `null` = não existe. */
  mercadopago(referenceId: string): Promise<FoundCharge | null>;
  /** Busca por `reference_id` (número do pedido). `null` = não existe. */
  pagbank(referenceId: string): Promise<FoundCharge | null>;
  /** Consulta pelo txid (a chave de idempotência sem os traços). `null` = não existe (404). */
  pix(txid: string): Promise<FoundCharge | null>;
}

export type StuckResult =
  | "paid"
  | "declined"
  | "not_found_failed"
  | "pending"
  | "skipped"
  | "error";

export interface StuckLogEntry {
  orderId: number;
  gateway: StuckGateway | "desconhecido";
  result: StuckResult;
  /** Só `true` na passada de teste (dry-run): nada foi gravado. */
  dryRun?: boolean;
}

export interface StuckDeps {
  /** Estado da tentativa pela chave (só leitura); `null` se a chave nunca existiu. */
  getAttemptState(key: string): Promise<string | null>;
  readers: GatewayReaders;
  /** Mesmo caminho do webhook: guarda a referência e reconcilia como pago. */
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
  if (paymentMethod === "inter_pix") return "inter";
  // Boleto do Inter: não há leitura por número do pedido; fica para quem olhar.
  return null;
}

/** Pedido pendente do checkout, sem cobrança guardada, com mais de 3 min e menos de 24 h. */
export function isStuckCandidate(order: WooCommerceOrder, nowMs: number): boolean {
  if (order.status !== "pending") return false;
  if (!order.metaData[IDEMPOTENCY_KEY_META]) return false;
  if (order.metaData[PAYMENT_REFERENCE_META]) return false;
  const createdAt = order.createdAtGmt ? Date.parse(order.createdAtGmt) : Number.NaN;
  if (!Number.isFinite(createdAt)) return false;
  const age = nowMs - createdAt;
  return age > STUCK_MIN_AGE_MS && age < STUCK_MAX_AGE_MS;
}

export async function reconcileStuckOrder(
  order: WooCommerceOrder,
  deps: StuckDeps,
): Promise<StuckResult> {
  const gateway = gatewayOf(order.paymentMethod);
  const report = (result: StuckResult): StuckResult => {
    deps.log({ orderId: order.id, gateway: gateway ?? "desconhecido", result });
    return result;
  };

  try {
    const key = order.metaData[IDEMPOTENCY_KEY_META];
    if (!key || !gateway) return report("skipped");

    // Só as tentativas que de fato pararam em PAYMENT_CREATING.
    if ((await deps.getAttemptState(key)) !== "PAYMENT_CREATING") return report("skipped");

    const found =
      gateway === "mercadopago"
        ? await deps.readers.mercadopago(String(order.id))
        : gateway === "pagbank"
          ? await deps.readers.pagbank(String(order.id))
          : await deps.readers.pix(key.replace(/-/g, ""));

    if (found?.category === "paid") {
      await deps.markPaid(order, gateway, found.externalId);
      return report("paid");
    }
    if (found?.category === "failed") {
      await deps.markDeclined(order, gateway, found.externalId);
      return report("declined");
    }
    if (found) {
      await deps.attachReference(order, gateway, found.externalId);
      return report("pending");
    }

    // Nenhuma cobrança no gateway: só desiste depois de 30 minutos.
    const createdAt = order.createdAtGmt ? Date.parse(order.createdAtGmt) : Number.NaN;
    if (Number.isFinite(createdAt) && deps.now() - createdAt >= STUCK_GIVE_UP_AGE_MS) {
      await deps.markNotFound(order);
      return report("not_found_failed");
    }
    return report("pending");
  } catch {
    // Erro de consulta ou de gravação: nada muda; a próxima passada tenta de novo.
    return report("error");
  }
}
