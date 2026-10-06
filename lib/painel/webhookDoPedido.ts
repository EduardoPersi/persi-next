/**
 * PEDIDO ATUALIZADO NO WOOCOMMERCE → PAINEL (fase 7 do painel de atendimento).
 *
 * A lógica do webhook `app/api/webhooks/woocommerce/pedido/route.ts`, sem nada
 * do Next: a rota só repassa a requisição e agenda o aviso com `after`. Assim
 * a regra inteira — quem entra, o "ping", o tópico, o que vai ao painel — é
 * testável (tests/painel/pedidoWebhook.test.mjs).
 *
 * Existe para o CANCELAMENTO: cancelado, reembolsado ou falho no WooCommerce
 * vira "Cancelado" no painel, que cancela a entrega que ainda não saiu, ou
 * avisa o gerente e o entregador da que já saiu. O pago NÃO vem por aqui: quem
 * conta o pago é a conciliação do pagamento, que confere o banco antes.
 */

import { verifyWooWebhookSignature } from "../catalog/webhookSecurity.ts";
import { orderFromWebhookPayload, type WooCommerceOrder } from "../../services/woocommerce/orders.ts";
import { situacaoDoWebhook } from "./pedido.ts";

export const LIMITE_DO_WEBHOOK_DE_PEDIDO = 262144;

export interface EntradaDoWebhook {
  bruto: Buffer;
  tipoDeConteudo: string | null;
  assinatura: string | null;
  topico: string | null;
  segredo: string;
}

export type SaidaDoWebhook =
  | { status: number; corpo: Record<string, unknown>; avisar?: undefined }
  | { status: 202; corpo: Record<string, unknown>; avisar: { pedido: WooCommerceOrder; situacao: "cancelado" } };

export function tratarWebhookDoPedido(e: EntradaDoWebhook): SaidaDoWebhook {
  // Sem segredo, FECHADO: nunca aberto por engano.
  if (!e.segredo) return { status: 503, corpo: { message: "Webhook de pedido não configurado." } };
  if (e.bruto.length > LIMITE_DO_WEBHOOK_DE_PEDIDO) return { status: 413, corpo: { message: "Payload inválido." } };

  // O "ping" que o WooCommerce manda ao salvar o webhook vem como formulário
  // (`webhook_id=…`), sem tópico. Tem de responder 2xx, senão o webhook não
  // fica ativo — e ele não faz nada além disso.
  const tipo = e.tipoDeConteudo?.split(";", 1)[0]?.trim().toLowerCase();
  if (tipo !== "application/json" && /^webhook_id=\d+$/.test(e.bruto.toString("utf8").trim())) {
    return { status: 200, corpo: { ok: true } };
  }

  if (!verifyWooWebhookSignature(e.bruto, e.assinatura, e.segredo)) {
    return { status: 401, corpo: { message: "Não autorizado." } };
  }
  if (e.topico !== "order.updated") return { status: 200, corpo: { ignorado: true } };

  let corpo: unknown;
  try {
    corpo = JSON.parse(e.bruto.toString("utf8"));
  } catch {
    return { status: 400, corpo: { message: "Payload inválido." } };
  }
  const pedido = orderFromWebhookPayload(corpo);
  if (!pedido) return { status: 422, corpo: { message: "Pedido inválido." } };

  const situacao = situacaoDoWebhook(pedido.status);
  if (!situacao) return { status: 200, corpo: { ignorado: true } };
  return { status: 202, corpo: { aceito: true }, avisar: { pedido, situacao } };
}
