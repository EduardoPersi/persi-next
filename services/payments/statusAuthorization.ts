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
