import { isPixChargeExpired, type PixChargeStatus } from "./inter/pix.ts";
import type { BoletoChargeStatus } from "./inter/boleto.ts";
import type { CardChargeStatus } from "./pagbank/charge.ts";
import type { MercadoPagoChargeStatus } from "./mercadopago/charge.ts";
import { avisarPedido } from "../../lib/painel/whatsapp.ts";
import { SITE_URL } from "../../lib/routing/storefrontUrls.ts";
import {
  findOrderByPaymentReference,
  markOrderAsFailed,
  markOrderAsPaid,
  alreadyPaidFor,
  type PaymentProvider,
  type WooCommerceOrder,
} from "../woocommerce/orders.ts";

export type PaymentStatusCategory = "paid" | "pending" | "failed";

/**
 * O aviso de "pagamento aprovado" no WhatsApp do cliente.
 *
 * Sem telefone no pedido não há para onde mandar — e isso não é erro: nem todo
 * checkout pede telefone.
 */
async function avisarPedidoPagoPeloWhatsapp(order: WooCommerceOrder) {
  if (!order.billingPhone) return { enviado: false as const };
  return avisarPedido({
    telefone: order.billingPhone,
    pedido: String(order.id),
    status: "Pagamento aprovado",
    link: `${SITE_URL}/minha-conta/pedidos/${order.id}`,
  });
}

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

export function categorizeMercadoPagoCardStatus(
  status: MercadoPagoChargeStatus,
): PaymentStatusCategory {
  if (status === "approved" || status === "authorized") return "paid";
  if (
    status === "rejected" ||
    status === "cancelled" ||
    status === "refunded" ||
    status === "charged_back"
  ) {
    return "failed";
  }
  return "pending";
}

export interface ReconcilePaymentReferenceDeps {
  findOrder: typeof findOrderByPaymentReference;
  markPaid: typeof markOrderAsPaid;
  /** A mesma pergunta que `markPaid` faz para decidir se escreve. */
  jaPago?: typeof alreadyPaidFor;
  markFailed: typeof markOrderAsFailed;
  /**
   * Opcional de propósito: quem injeta deps num teste não deve ser obrigado a
   * conhecer o aviso do WhatsApp para exercitar a conciliação de pagamento.
   */
  avisarPedido?: (order: WooCommerceOrder) => Promise<unknown>;
}

const defaultDeps: ReconcilePaymentReferenceDeps = {
  findOrder: findOrderByPaymentReference,
  markPaid: markOrderAsPaid,
  jaPago: alreadyPaidFor,
  markFailed: markOrderAsFailed,
  avisarPedido: avisarPedidoPagoPeloWhatsapp,
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
    // A PRIMEIRA DAS DUAS TRAVAS CONTRA O AVISO EM DOBRO.
    //
    // O provedor reenvia webhook: é o comportamento normal dele quando a
    // resposta demora ou vem com erro. `markPaid` já era idempotente — não
    // reescreve um pedido que já está pago por esta referência —, mas o aviso
    // saía logo abaixo SEM perguntar nada, e o cliente recebia a mensagem
    // tantas vezes quantas o provedor insistisse.
    //
    // Medido ANTES de marcar: depois de `markPaid` o pedido está pago nos dois
    // casos, e não haveria como distinguir "acabou de pagar" de "já estava".
    // `deps.jaPago` é opcional e cai na regra de verdade: os testes que já
    // existiam passam um `deps` parcial, e exigir a chave aqui os quebraria —
    // sem que nenhum deles estivesse errado.
    const jaEstavaPago = (deps.jaPago ?? alreadyPaidFor)(order, { externalId });

    const pago = await deps.markPaid(order, { provider, externalId });

    // O aviso pelo WhatsApp sai DEPOIS de o pedido estar marcado como pago, e
    // solto: é o painel de atendimento do outro lado, e ele estar fora do ar
    // não pode desfazer um pagamento que já entrou. `avisarPedido` nunca
    // lança — o `catch` aqui é cinto e suspensório.
    if (!jaEstavaPago) void deps.avisarPedido?.(pago)?.catch(() => {});
    return { order: pago, category };
  }
  if (category === "failed") {
    return { order: await deps.markFailed(order, "failed"), category };
  }
  return { order, category };
}
