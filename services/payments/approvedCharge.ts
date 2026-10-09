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
 *   3. moeda BRL (a loja só vende em reais). Se o gateway devolver outra moeda,
 *      não marca pago. Se não devolver, assume BRL e avisa (`currencyAssumed`).
 *
 * O valor comparado é o da COMPRA, sem juros do parcelamento: Mercado Pago
 * `transaction_amount` (não `total_paid_amount`) e PagBank `amount.value` (a
 * cobrança sem taxas). O cliente que parcela com juros paga mais que o pedido, e
 * isso é esperado.
 *
 * Qualquer falha deixa o pedido como está: o webhook e a varredura de pendentes
 * continuam como rede de segurança. Código puro, sem rede.
 */

export type ApprovalProvider = "mercadopago" | "pagbank";

export interface GatewayChargeForApproval {
  status: string;
  /**
   * Valor da COMPRA em unidades da moeda (ex.: 199.9), sem juros de parcelamento:
   * Mercado Pago `transaction_amount`, PagBank `amount.value` / 100.
   */
  amount: number;
  /** Moeda informada pelo gateway (ex.: "BRL"); ausente = assume BRL. */
  currency?: string;
}

export interface OrderForApproval {
  /** Total do pedido como o WooCommerce devolve (ex.: "199.90"). */
  total: string;
  currency: string;
}

export type ApprovalCheck =
  | {
      approved: true;
      /** O gateway não informou a moeda e foi assumido BRL: quem chama registra `currency_assumed_brl`. */
      currencyAssumed?: true;
    }
  | {
      approved: false;
      reason: "not_approved" | "invalid_amount" | "amount_mismatch" | "currency_mismatch";
    };

/** A única moeda em que a loja vende. */
export const STORE_CURRENCY = "BRL";

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
  const orderCurrency = order.currency.trim().toUpperCase();
  // Pedido em outra moeda que não BRL nunca foi vendido por esta loja: não marca pago.
  if (orderCurrency && orderCurrency !== STORE_CURRENCY) {
    return { approved: false, reason: "currency_mismatch" };
  }
  if (!chargeCurrency) return { approved: true, currencyAssumed: true };
  if (chargeCurrency !== STORE_CURRENCY) return { approved: false, reason: "currency_mismatch" };
  return { approved: true };
}
