/**
 * Reconciliação de cobrança de CARTÃO com a regra estrita de "pago", a mesma em
 * todo o site (webhooks, rota de status, cron de pendentes, página de confirmação
 * e a varredura de travados).
 *
 * Quem chama já consultou o gateway (nunca confia no corpo do webhook). Aqui, antes
 * de marcar o pedido como pago, vale `verifyApprovedCharge`: status aprovado e
 * capturado (Mercado Pago `approved`; PagBank `PAID`), valor da compra igual ao
 * total do pedido ao centavo e moeda BRL (padrão BRL, com aviso). Se a conferência
 * falhar, o pedido NÃO é marcado como pago e o resultado volta como "pending" (o
 * motivo vai ao log, sem dado pessoal). Recusa e cancelamento seguem como "failed".
 */

import { categorizeCardByStatus, evaluateCardCharge } from "./chargeEvaluation.ts";
import { reconcilePaymentReference, type PaymentStatusCategory } from "./reconcile.ts";
import { findOrderByPaymentReference, type WooCommerceOrder } from "../woocommerce/orders.ts";

export type CardProvider = "mercadopago" | "pagbank";

export interface CardChargeForReconcile {
  status: string;
  amount: number;
  currency?: string;
}

export interface CardReconcileDeps {
  findOrder(provider: CardProvider, externalId: string): Promise<WooCommerceOrder | null>;
  reconcile(provider: CardProvider, externalId: string, category: PaymentStatusCategory): Promise<unknown>;
  log(message: string, details: { orderId: number; provider: CardProvider; reason: string }): void;
}

const defaultDeps: CardReconcileDeps = {
  findOrder: findOrderByPaymentReference,
  reconcile: reconcilePaymentReference,
  log: (message, details) => console.warn(message, details),
};

/**
 * Decide a categoria final de uma cobrança já consultada: "paid" só se o status
 * for aprovado E o valor/moeda conferirem com o pedido. Sem conferência, "pending".
 */
export function resolveVerifiedCategory(
  provider: CardProvider,
  charge: CardChargeForReconcile,
  order: WooCommerceOrder,
  log: CardReconcileDeps["log"] = defaultDeps.log,
): PaymentStatusCategory {
  const evaluation = evaluateCardCharge(provider, charge, { total: order.total, currency: order.currency });
  if (evaluation.category === "unverified") {
    log("[pagamento-cartao] cobrança aprovada não confere com o pedido", {
      orderId: order.id,
      provider,
      reason: evaluation.reason,
    });
    return "pending";
  }
  if (evaluation.category === "paid" && evaluation.currencyAssumed) {
    log("[pagamento-cartao] moeda não informada pelo gateway", {
      orderId: order.id,
      provider,
      reason: "currency_assumed_brl",
    });
  }
  // "closed" não existe para cartão.
  return evaluation.category === "closed" ? "pending" : evaluation.category;
}

export async function reconcileCardCharge(
  provider: CardProvider,
  externalId: string,
  charge: CardChargeForReconcile,
  deps: CardReconcileDeps = defaultDeps,
): Promise<PaymentStatusCategory> {
  // Recusa e pendente não dependem de valor: só o "pago" é conferido contra o pedido.
  const byStatus = categorizeCardByStatus(provider, charge.status);
  if (byStatus !== "paid") {
    await deps.reconcile(provider, externalId, byStatus);
    return byStatus;
  }

  const order = await deps.findOrder(provider, externalId);
  // Sem pedido para a referência, não há o que conferir nem marcar.
  if (!order) return "paid";

  const verified = resolveVerifiedCategory(provider, charge, order, deps.log);
  if (verified === "paid") await deps.reconcile(provider, externalId, "paid");
  return verified;
}
