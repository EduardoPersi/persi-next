import { isPixChargeExpired, type PixChargeStatus } from "./inter/pix.ts";
import type { BoletoChargeStatus } from "./inter/boleto.ts";
import type { CardChargeStatus } from "./pagbank/charge.ts";
import {
  findOrderByPaymentReference,
  markOrderAsFailed,
  markOrderAsPaid,
  type PaymentProvider,
  type WooCommerceOrder,
} from "../woocommerce/orders.ts";

export type PaymentStatusCategory = "paid" | "pending" | "failed";

export function categorizePixStatus(charge: {
  status: PixChargeStatus;
  expiresAt: string;
}): PaymentStatusCategory {
  if (charge.status === "CONCLUIDA") return "paid";
  if (
    charge.status === "REMOVIDA_PELO_USUARIO_RECEBEDOR" ||
    charge.status === "REMOVIDA_PELO_PSP"
  ) {
    return "failed";
  }
  // A API Pix não tem um status "expirada" — precisamos comparar contra
  // `expiresAt` nós mesmos (ver services/payments/inter/pix.ts).
  if (isPixChargeExpired(charge)) return "failed";
  return "pending";
}

export function categorizeBoletoStatus(status: BoletoChargeStatus): PaymentStatusCategory {
  if (status === "MARCADO_RECEBIDO") return "paid";
  if (status === "CANCELADO" || status === "EXPIRADO" || status === "FALHA_EMISSAO") {
    return "failed";
  }
  return "pending";
}

export function categorizeCardStatus(status: CardChargeStatus): PaymentStatusCategory {
  if (status === "PAID" || status === "AUTHORIZED") return "paid";
  if (status === "DECLINED" || status === "CANCELED") return "failed";
  return "pending";
}

export interface ReconcilePaymentReferenceDeps {
  findOrder: typeof findOrderByPaymentReference;
  markPaid: typeof markOrderAsPaid;
  markFailed: typeof markOrderAsFailed;
}

const defaultDeps: ReconcilePaymentReferenceDeps = {
  findOrder: findOrderByPaymentReference,
  markPaid: markOrderAsPaid,
  markFailed: markOrderAsFailed,
};

export interface PaymentReconciliationResult {
  order: WooCommerceOrder | null;
  category: PaymentStatusCategory;
}

// Nunca confia no corpo de um webhook como fonte de verdade: quem chama esta
// função já reconsultou o status diretamente na API do provedor (Inter ou
// PagBank) antes de categorizá-lo. Esta função só decide o que fazer com o
// pedido WooCommerce a partir desse status confirmado, de forma idempotente
// (markOrderAsPaid/markOrderAsFailed não reescrevem um pedido que já está no
// status alvo).
export async function reconcilePaymentReference(
  provider: PaymentProvider,
  externalId: string,
  category: PaymentStatusCategory,
  deps: ReconcilePaymentReferenceDeps = defaultDeps,
): Promise<PaymentReconciliationResult> {
  const order = await deps.findOrder(provider, externalId);
  if (!order) return { order: null, category };

  if (category === "paid") {
    return { order: await deps.markPaid(order, { provider, externalId }), category };
  }
  if (category === "failed") {
    return { order: await deps.markFailed(order, "failed"), category };
  }
  return { order, category };
}
