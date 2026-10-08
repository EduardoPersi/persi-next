import type { CheckoutShippingRate } from "../../types/cart.ts";
import {
  arrivalDateForRate,
  isPickupRate,
  type ArrivalDestination,
} from "./calendar/arrival.ts";

/**
 * SELOS "MAIS BARATO" / "MAIS RÁPIDO" nas opções de frete.
 *
 * Só visual: o selo aparece ao lado do nome ORIGINAL do frete (a loja tem dois
 * "Frete Expresso"), e nada muda no valor, no id do método, na ordem nem no que
 * vai para o pedido. Puro: o relógio entra de fora (o prazo depende de "agora").
 *
 * Regras:
 *   - só concorrem as opções PAGAS; retirada na loja e frete grátis ficam fora
 *     da comparação e nunca recebem selo;
 *   - com menos de 2 opções pagas, nenhum selo;
 *   - "Mais barato": menor preço; empate, menor prazo;
 *   - "Mais rápido": menor prazo (a previsão de chegada); empate, menor preço.
 *     Opção sem prazo não concorre a este selo;
 *   - a mesma opção nos dois: um selo só, "Mais barato e mais rápido".
 */

export type ShippingBadge = "cheapest" | "fastest" | "cheapest-and-fastest";

export const SHIPPING_BADGE_LABEL: Record<ShippingBadge, string> = {
  cheapest: "Mais barato",
  fastest: "Mais rápido",
  "cheapest-and-fastest": "Mais barato e mais rápido",
};

export interface ShippingBadgeCandidate {
  id: string;
  /** Preço em centavos (qualquer unidade, desde que igual entre as opções). */
  price: number;
  /** Data de chegada `AAAA-MM-DD`, ou null quando não há previsão. */
  arrival: string | null;
}

function compareArrival(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function best(
  candidates: readonly ShippingBadgeCandidate[],
  compare: (a: ShippingBadgeCandidate, b: ShippingBadgeCandidate) => number,
): ShippingBadgeCandidate | undefined {
  // `reduce` mantém o primeiro em caso de empate total (ordem da loja).
  return candidates.reduce<ShippingBadgeCandidate | undefined>(
    (winner, candidate) =>
      !winner || compare(candidate, winner) < 0 ? candidate : winner,
    undefined,
  );
}

/** Selo de cada opção (por id). Opções sem selo não aparecem no resultado. */
export function pickShippingBadges(
  candidates: readonly ShippingBadgeCandidate[],
): Record<string, ShippingBadge> {
  if (candidates.length < 2) return {};

  const cheapest = best(
    candidates,
    (a, b) => a.price - b.price || compareArrival(a.arrival, b.arrival),
  );
  const fastest = best(
    candidates.filter((candidate) => candidate.arrival !== null),
    (a, b) => compareArrival(a.arrival, b.arrival) || a.price - b.price,
  );

  const badges: Record<string, ShippingBadge> = {};
  if (cheapest) badges[cheapest.id] = "cheapest";
  if (fastest) {
    badges[fastest.id] =
      cheapest?.id === fastest.id ? "cheapest-and-fastest" : "fastest";
  }
  return badges;
}

function priceInMinorUnits(rate: CheckoutShippingRate): number | null {
  if (!/^\d+$/.test(rate.price.value)) return null;
  return Number(rate.price.value);
}

/**
 * Selos das opções de UM pacote de frete, a partir das tarifas do carrinho.
 * Chave do resultado: `rateId`.
 */
export function shippingBadgesForRates(
  rates: readonly CheckoutShippingRate[],
  destination: ArrivalDestination,
  now: Date,
): Record<string, ShippingBadge> {
  const candidates: ShippingBadgeCandidate[] = [];
  for (const rate of rates) {
    if (isPickupRate(rate)) continue;
    const price = priceInMinorUnits(rate);
    if (price === null || price <= 0) continue; // sem preço válido ou grátis
    candidates.push({
      id: rate.rateId,
      price,
      arrival: arrivalDateForRate(rate, destination, now),
    });
  }
  return pickShippingBadges(candidates);
}
