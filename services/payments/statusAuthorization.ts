import { safeCompareSecret } from "./cronReconciliation.ts";
import { getCheckoutOwnerToken, type WooCommerceOrder } from "../woocommerce/orders.ts";

// Só quem criou o pedido pode consultar (ou forçar a reconciliação de) o
// status do pagamento. Duas fontes de autorização, qualquer uma basta:
// - o mesmo Cart-Token do WooCommerce Store API (JWT assinado, httpOnly)
//   que estava ativo quando o pedido foi criado (checkout como convidado
//   ou logado, mesma sessão de navegador); ou
// - uma sessão de conta autenticada cujo e-mail bate com o billing do
//   pedido (cliente logado consultando de uma sessão diferente da que
//   fez o checkout).
/** Janela em que a posse da chave da tentativa vale como prova (a mesma da chave pendente do navegador). */
export const ATTEMPT_KEY_AUTHORIZATION_WINDOW_MS = 30 * 60 * 1000;

/**
 * Segunda prova, só para RETOMAR um pagamento depois de recarregar a página: a
 * chave de idempotência da tentativa (UUID aleatório que só o navegador de quem
 * pagou conhece, guardado na sessionStorage dele). O Cart-Token do navegador pode
 * ficar para trás quando o F5 derruba a resposta do pagamento (é nela que o cookie
 * novo viaja), e então a prova do cookie falha para o próprio dono do pedido.
 *
 * Vale só se a chave é a do pedido e o pedido tem menos de 30 minutos. Quem chama
 * usa isto para devolver o desfecho da tentativa (sem dado pessoal) e para
 * reencaixar o cookie; nunca para mostrar dados do pedido.
 */
export function isAuthorizedByAttemptKey(
  order: WooCommerceOrder,
  attemptKey: string,
  nowMs: number,
): boolean {
  const orderKey = order.metaData["_persi_idempotency_key"];
  if (!attemptKey || !orderKey || !safeCompareSecret(attemptKey, orderKey)) return false;
  const createdAt = order.createdAtGmt ? Date.parse(order.createdAtGmt) : Number.NaN;
  if (!Number.isFinite(createdAt)) return false;
  const age = nowMs - createdAt;
  return age >= 0 && age < ATTEMPT_KEY_AUTHORIZATION_WINDOW_MS;
}

export function isAuthorizedForOrderStatus(
  order: WooCommerceOrder,
  requestCartToken: string | undefined,
  sessionEmail: string | undefined,
): boolean {
  const ownerToken = getCheckoutOwnerToken(order);
  if (requestCartToken && ownerToken && safeCompareSecret(requestCartToken, ownerToken)) {
    return true;
  }

  if (sessionEmail && order.billingEmail) {
    return sessionEmail.trim().toLowerCase() === order.billingEmail.trim().toLowerCase();
  }

  return false;
}
