/**
 * Quando uma cobrança de cartão pode marcar o pedido como PAGO sem esperar o
 * webhook do gateway.
 *
 * Três exigências, todas juntas, sobre uma consulta NOVA ao gateway pelo id da
 * cobrança (nunca só a resposta da criação):
 *   1. status realmente aprovado e capturado: Mercado Pago `approved`;
 *      PagBank `PAID`. `authorized`/`AUTHORIZED` (autorizado, sem captura),
 *      `in_process`, `pending` e qualquer outro NÃO contam;
 *   2. valor igual ao total do pedido, ao centavo;
 *   3. moeda igual à do pedido. Se o gateway não informar a moeda, não há como
 *      conferir: não marca pago.
 *
 * Qualquer falha deixa o pedido como está: o webhook e a varredura de pendentes
 * continuam como rede de segurança. Código puro, sem rede.
 */

export type ApprovalProvider = "mercadopago" | "pagbank";

export interface GatewayChargeForApproval {
  status: string;
  /** Valor da cobrança em unidades da moeda (ex.: 199.9). */
  amount: number;
  /** Moeda informada pelo gateway (ex.: "BRL"); ausente = não conferível. */
  currency?: string;
}

export interface OrderForApproval {
  /** Total do pedido como o WooCommerce devolve (ex.: "199.90"). */
  total: string;
  currency: string;
}

export type ApprovalCheck =
  | { approved: true }
  | {
      approved: false;
      reason:
        | "not_approved"
        | "invalid_amount"
        | "amount_mismatch"
        | "currency_unverified"
        | "currency_mismatch";
    };

/** Status que significa "aprovado e capturado" em cada gateway. */
export function isApprovedStatus(provider: ApprovalProvider, status: string): boolean {
  return provider === "mercadopago" ? status === "approved" : status === "PAID";
}

function toCents(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function verifyApprovedCharge(
  provider: ApprovalProvider,
  charge: GatewayChargeForApproval,
  order: OrderForApproval,
): ApprovalCheck {
  if (!isApprovedStatus(provider, charge.status)) {
    return { approved: false, reason: "not_approved" };
  }

  const paid = toCents(charge.amount);
  const expected = toCents(Number(order.total));
  if (paid === null || expected === null || expected <= 0) {
    return { approved: false, reason: "invalid_amount" };
  }
  if (paid !== expected) return { approved: false, reason: "amount_mismatch" };

  const chargeCurrency = charge.currency?.trim().toUpperCase();
  if (!chargeCurrency) return { approved: false, reason: "currency_unverified" };
  if (chargeCurrency !== order.currency.trim().toUpperCase()) {
    return { approved: false, reason: "currency_mismatch" };
  }
  return { approved: true };
}
