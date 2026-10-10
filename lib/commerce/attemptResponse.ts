import {
  isAuthorizedByAttemptKey,
  isAuthorizedForOrderStatus,
} from "../../services/payments/statusAuthorization.ts";
import type { WooCommerceOrder } from "../../services/woocommerce/orders.ts";
import type { AttemptOutcome } from "./paymentPolling.ts";

/**
 * O que a consulta da tentativa (`GET /api/checkout/payment/attempt`) devolve.
 *
 *   "full"  o navegador tem o Cart-Token certo ou a conta do pedido: pode ir para a
 *           página completa do pedido;
 *   "key"   só provou ser o dono pela chave da tentativa (pedido com menos de 30
 *           minutos): recebe apenas o desfecho e o número do pedido;
 *   "none"  não provou nada: a rota responde "processando", como se nada tivesse
 *           acontecido.
 *
 * Nunca devolve cookie nem token, em nenhum dos casos.
 */
export type AttemptAccess = "full" | "key" | "none";

export function resolveAttemptAccess(input: {
  order: WooCommerceOrder;
  cartToken: string | undefined;
  sessionEmail: string | undefined;
  key: string;
  nowMs: number;
}): AttemptAccess {
  if (isAuthorizedForOrderStatus(input.order, input.cartToken, input.sessionEmail)) return "full";
  if (isAuthorizedByAttemptKey(input.order, input.key, input.nowMs)) return "key";
  return "none";
}

export interface AttemptResponseBody {
  outcome: AttemptOutcome;
  confirmationUrl?: string;
  orderNumber?: number;
}

export function buildAttemptResponseBody(input: {
  outcome: AttemptOutcome;
  access: AttemptAccess;
  key: string;
  orderId: number;
}): AttemptResponseBody {
  if (input.access === "none") return { outcome: "processing" };
  if (input.outcome !== "created") return { outcome: input.outcome };
  return input.access === "full"
    ? {
        outcome: "created",
        confirmationUrl: `/checkout/confirmacao?attempt=${encodeURIComponent(input.key)}`,
      }
    : { outcome: "created", orderNumber: input.orderId };
}
