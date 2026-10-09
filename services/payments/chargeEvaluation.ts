/**
 * Conferência única de uma cobrança já consultada no gateway contra o pedido.
 *
 * Devolve uma categoria que separa o que o site faz de cada caso:
 *   paid        → status aprovado/capturado E valor igual ao total E moeda BRL;
 *   unverified  → o gateway diz "pago", mas valor, moeda ou campo não conferem: NÃO
 *                 marca pago, só registra o motivo;
 *   failed      → recusa/cancelamento de CARTÃO (definitivo);
 *   closed      → Pix expirado/removido ou boleto vencido/cancelado: só log, quem
 *                 decide cancelar é o fluxo que já existe (cron de pendentes);
 *   pending     → ainda aguardando.
 *
 * Código puro, sem rede.
 */

import { verifyApprovedCharge, type ApprovalCheck } from "./approvedCharge.ts";
import {
  categorizeCardStatus,
  categorizeMercadoPagoCardStatus,
  type PaymentStatusCategory,
} from "./reconcile.ts";
import type { PixChargeStatus } from "./inter/pix.ts";
import type { BoletoChargeStatus } from "./inter/boleto.ts";

export interface OrderForEvaluation {
  total: string;
  currency: string;
}

export type ChargeEvaluation =
  | { category: "paid"; currencyAssumed?: true }
  | { category: "unverified"; reason: Extract<ApprovalCheck, { approved: false }>["reason"] }
  | { category: "failed" | "closed" | "pending" };

function fromCheck(check: ApprovalCheck): ChargeEvaluation {
  if (!check.approved) return { category: "unverified", reason: check.reason };
  return check.currencyAssumed ? { category: "paid", currencyAssumed: true } : { category: "paid" };
}

/** Só pelo status (sem valor): `paid` apenas para aprovado/capturado. */
export function categorizeCardByStatus(
  provider: "mercadopago" | "pagbank",
  status: string,
): PaymentStatusCategory {
  return provider === "mercadopago"
    ? categorizeMercadoPagoCardStatus(status as Parameters<typeof categorizeMercadoPagoCardStatus>[0])
    : categorizeCardStatus(status as Parameters<typeof categorizeCardStatus>[0]);
}

export function evaluateCardCharge(
  provider: "mercadopago" | "pagbank",
  charge: { status: string; amount: number; currency?: string },
  order: OrderForEvaluation,
): ChargeEvaluation {
  const category = categorizeCardByStatus(provider, charge.status);
  if (category !== "paid") return { category };
  return fromCheck(verifyApprovedCharge(provider, charge, order));
}

/** Pix: `valor.original`; o Inter só opera em reais, então a moeda é BRL. Valor ausente = não marca pago. */
export function evaluatePixCharge(
  charge: { status: PixChargeStatus; expiresAt: string; amount?: number },
  order: OrderForEvaluation,
  nowMs: number,
): ChargeEvaluation {
  if (charge.status === "CONCLUIDA") {
    return fromCheck(
      verifyApprovedCharge("inter_pix", { status: charge.status, amount: charge.amount ?? Number.NaN, currency: "BRL" }, order),
    );
  }
  if (charge.status === "REMOVIDA_PELO_USUARIO_RECEBEDOR" || charge.status === "REMOVIDA_PELO_PSP") {
    return { category: "closed" };
  }
  const expiresAt = Date.parse(charge.expiresAt);
  if (Number.isFinite(expiresAt) && nowMs > expiresAt) return { category: "closed" };
  return { category: "pending" };
}

/** Boleto: `valorNominal`. Vencido (`ATRASADO`), expirado ou cancelado = só log. */
export function evaluateBoletoCharge(
  charge: { status: BoletoChargeStatus; amount?: number },
  order: OrderForEvaluation,
): ChargeEvaluation {
  if (charge.status === "MARCADO_RECEBIDO") {
    return fromCheck(
      verifyApprovedCharge("inter_boleto", { status: charge.status, amount: charge.amount ?? Number.NaN, currency: "BRL" }, order),
    );
  }
  if (
    charge.status === "ATRASADO" ||
    charge.status === "CANCELADO" ||
    charge.status === "EXPIRADO" ||
    charge.status === "FALHA_EMISSAO"
  ) {
    return { category: "closed" };
  }
  return { category: "pending" };
}
