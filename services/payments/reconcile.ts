import { isPixChargeExpired, type PixChargeStatus } from "./inter/pix.ts";
import type { BoletoChargeStatus } from "./inter/boleto.ts";
import type { CardChargeStatus } from "./pagbank/charge.ts";
import type { MercadoPagoChargeStatus } from "./mercadopago/charge.ts";
import { avisarSituacaoDoPedido } from "../../lib/painel/pedido.ts";
import {
  findOrderByPaymentReference,
  isOrderAlreadyFailed,
  isOrderAlreadyPaidFor,
  markOrderAsFailed,
  markOrderAsPaid,
  type PaymentProvider,
  type WooCommerceOrder,
} from "../woocommerce/orders.ts";

export type PaymentStatusCategory = "paid" | "pending" | "failed";

/**
 * O aviso de "pagamento aprovado" ao painel (que escreve ao cliente pelo
 * WhatsApp quando `pago: true`), agora com e-mail e origem da compra.
 *
 * Sem telefone no pedido não há para onde mandar — e isso não é erro: nem todo
 * checkout pede telefone (a regra está em `montarAvisoDoPedido`).
 */
async function avisarPedidoPagoPeloWhatsapp(order: WooCommerceOrder) {
  return avisarSituacaoDoPedido(order, "pago");
}

/**
 * Pedido cancelado/expirado → `pago: false`, status "Cancelado". Só sai com
 * `PAINEL_NOTIFICAR_PEDIDO_PENDENTE=1`; o painel NÃO escreve ao cliente nesse
 * caso. Nunca é chamado para pedido pendente.
 */
async function avisarPedidoCanceladoNoPainel(order: WooCommerceOrder) {
  return avisarSituacaoDoPedido(order, "cancelado");
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
  markFailed: typeof markOrderAsFailed;
  /**
   * Opcional de propósito: quem injeta deps num teste não deve ser obrigado a
   * conhecer o aviso do WhatsApp para exercitar a conciliação de pagamento.
   */
  avisarPedido?: (order: WooCommerceOrder) => Promise<unknown>;
  /** Idem: opcional, para não obrigar testes antigos a conhecer o painel. */
  avisarCancelado?: (order: WooCommerceOrder) => Promise<unknown>;
}

const defaultDeps: ReconcilePaymentReferenceDeps = {
  findOrder: findOrderByPaymentReference,
  markPaid: markOrderAsPaid,
  markFailed: markOrderAsFailed,
  avisarPedido: avisarPedidoPagoPeloWhatsapp,
  avisarCancelado: avisarPedidoCanceladoNoPainel,
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
    // Lido ANTES de marcar: o aviso é da MUDANÇA para pago. O banco reenvia
    // webhook, a página de confirmação consulta de novo e o cron reconcilia — a
    // mesma cobrança paga passa por aqui várias vezes, e só a primeira pode
    // gerar mensagem ao cliente.
    const jaEstavaPago = isOrderAlreadyPaidFor(order, externalId);
    const pago = await deps.markPaid(order, { provider, externalId });
    // O aviso sai DEPOIS de o pedido estar marcado como pago, e solto: é o
    // painel de atendimento do outro lado, e ele estar fora do ar não pode
    // desfazer um pagamento que já entrou. `avisarPedido` nunca lança — o
    // `catch` aqui é cinto e suspensório.
    if (!jaEstavaPago) void deps.avisarPedido?.(pago)?.catch(() => {});
    return { order: pago, category };
  }
  if (category === "failed") {
    const jaEstavaCancelado = isOrderAlreadyFailed(order);
    const falho = await deps.markFailed(order, "failed");
    // Mesmo princípio: só a mudança para cancelado vai ao painel.
    if (!jaEstavaCancelado) void deps.avisarCancelado?.(falho)?.catch(() => {});
    return { order: falho, category };
  }
  return { order, category };
}
