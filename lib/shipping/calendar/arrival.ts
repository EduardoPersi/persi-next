/**
 * DA OPÇÃO DE FRETE PARA O TEXTO DE CHEGADA ("Chega quinta, dia 9").
 *
 * Junta o que a tela já tem de cada frete (método, prazo da transportadora,
 * CEP/cidade de destino) com o calendário de `deliveryDate.ts`. Puro: o relógio
 * entra de fora.
 *
 * Três tipos de frete, pelo `methodId` do WooCommerce:
 *   - ENTREGA PRÓPRIA da loja (`flat_rate`, `free_shipping`): não traz prazo; o
 *     prazo vem da ZONA do destino (abaixo);
 *   - RETIRADA (`local_pickup`, `pickup_location`): "Retire hoje" antes do corte
 *     e "Retire a partir de [próximo dia de trabalho]" depois dele;
 *   - TRANSPORTADORA (Melhor Envio, Olist Envios…): usa os dias úteis que o
 *     provedor informa (`melhorenvio_delivery_time`, `delivery_time` ou
 *     "2 dias úteis" no texto do prazo). Sem prazo, sem previsão.
 *
 * ZONAS da entrega própria (decisão da Persi, 07/10/2026):
 *   Jundiaí         sai no mesmo dia se o pedido entrar antes do corte, senão
 *                   no dia seguinte (0 dias de operação depois do despacho);
 *   demais regiões  1 dia antes do corte, 2 depois (1 dia de operação).
 */

import type { CivilDate } from "./civilDate.ts";
import { civilDateInSaoPaulo } from "./civilDate.ts";
import {
  DEFAULT_STORE_PLACE,
  dispatchDate,
  estimateCarrierArrival,
  estimateOwnDeliveryArrival,
  formatArrival,
  formatPickup,
  type DeliveryContext,
} from "./deliveryDate.ts";
import { DEFAULT_HOLIDAYS_CSV } from "./holidaysDefault.ts";
import { normalizeText, parseHolidayCsv, type Holiday } from "./holidays.ts";

export interface OwnDeliveryZone {
  name: string;
  /** Faixas de CEP "13200000-13219999" (só dígitos). */
  postcodeRanges?: string[];
  /** Nomes de cidade (sem distinção de acento ou maiúscula). */
  cities?: string[];
  /** Dias de operação da loja DEPOIS do dia de despacho (0 = no próprio dia). */
  operatingDays: number;
}

export const DEFAULT_OWN_DELIVERY_ZONES: readonly OwnDeliveryZone[] = [
  { name: "Jundiaí", postcodeRanges: ["13200000-13219999"], cities: ["Jundiaí"], operatingDays: 0 },
];
/** Qualquer outro destino atendido pela entrega própria. */
export const DEFAULT_OWN_DELIVERY_OTHER_DAYS = 1;

export const DEFAULT_OWN_METHOD_IDS: readonly string[] = ["flat_rate", "free_shipping"];
const PICKUP_METHOD_IDS: readonly string[] = ["local_pickup", "pickup_location"];

export interface ArrivalRate {
  methodId?: string;
  /** Texto do prazo que o frete traz ("2 dias úteis" ou "2"). */
  deliveryTime?: string;
  metaData?: ReadonlyArray<{ key: string; value: string }>;
}

export interface ArrivalDestination {
  postcode?: string;
  city?: string;
  uf?: string;
}

export interface ArrivalOptions {
  ownZones?: readonly OwnDeliveryZone[];
  ownOtherDays?: number;
  ownMethodIds?: readonly string[];
  /** Calendário e corte. Sem isso, a lista padrão da Persi e o corte de 13h (sábado 10h30). */
  context?: DeliveryContext;
}

let defaultHolidays: Holiday[] | null = null;
function holidaysPadrao(): Holiday[] {
  defaultHolidays ??= parseHolidayCsv(DEFAULT_HOLIDAYS_CSV).holidays;
  return defaultHolidays;
}

function postcodeDigits(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function postcodeInRange(postcode: string, range: string): boolean {
  const [from, to] = range.split("-");
  if (postcode.length !== 8 || !/^\d{8}$/.test(from ?? "") || !/^\d{8}$/.test(to ?? "")) return false;
  return Number(postcode) >= Number(from) && Number(postcode) <= Number(to);
}

/** Dias de operação depois do despacho para este destino. */
export function ownDeliveryDays(
  destination: ArrivalDestination,
  zones: readonly OwnDeliveryZone[] = DEFAULT_OWN_DELIVERY_ZONES,
  otherDays: number = DEFAULT_OWN_DELIVERY_OTHER_DAYS,
): number {
  const postcode = postcodeDigits(destination.postcode);
  const city = destination.city ? normalizeText(destination.city) : "";
  for (const zone of zones) {
    const byPostcode = Boolean(postcode) && (zone.postcodeRanges ?? []).some((range) => postcodeInRange(postcode, range));
    const byCity = Boolean(city) && (zone.cities ?? []).some((name) => normalizeText(name) === city);
    if (byPostcode || byCity) return zone.operatingDays;
  }
  return otherDays;
}

/** Dias úteis de trânsito que o provedor informa, ou `null`. */
export function transitDaysOfRate(rate: ArrivalRate): number | null {
  const fromMeta = rate.metaData?.find(
    (entry) => entry.key === "melhorenvio_delivery_time" || entry.key === "delivery_time",
  )?.value;
  const text = fromMeta ?? rate.deliveryTime ?? "";
  const match = /(\d+)/.exec(text);
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isInteger(days) && days >= 0 && days <= 90 ? days : null;
}

function startsWithId(methodId: string, ids: readonly string[]): boolean {
  const id = methodId.trim().toLowerCase();
  return ids.some((candidate) => id === candidate || id.startsWith(`${candidate}:`) || id.startsWith(`${candidate}_`));
}

/**
 * A previsão de chegada deste frete, ou `null` quando não há como (retirada, ou
 * transportadora sem prazo).
 */
export function arrivalDateForRate(
  rate: ArrivalRate,
  destination: ArrivalDestination,
  now: Date,
  options: ArrivalOptions = {},
): CivilDate | null {
  const methodId = rate.methodId ?? "";
  if (startsWithId(methodId, PICKUP_METHOD_IDS)) return null;

  const context: DeliveryContext = options.context ?? { holidays: holidaysPadrao(), store: DEFAULT_STORE_PLACE };
  const place = { uf: destination.uf, city: destination.city };

  if (startsWithId(methodId, options.ownMethodIds ?? DEFAULT_OWN_METHOD_IDS)) {
    const days = ownDeliveryDays(destination, options.ownZones, options.ownOtherDays);
    return estimateOwnDeliveryArrival(now, days, context);
  }

  const transit = transitDaysOfRate(rate);
  if (transit === null) return null;
  return estimateCarrierArrival(now, transit, context, place);
}

/** A retirada na loja é pelo `methodId` do WooCommerce (`local_pickup`, `pickup_location`). */
export function isPickupRate(rate: ArrivalRate): boolean {
  return startsWithId(rate.methodId ?? "", PICKUP_METHOD_IDS);
}

/**
 * O texto pronto para a tela, ou `null`. Entrega e transportadora: "Chega
 * quinta, dia 9". Retirada na loja: "Retire hoje" antes do corte e "Retire a
 * partir de [próximo dia de trabalho]" depois dele.
 */
export function arrivalTextForRate(
  rate: ArrivalRate,
  destination: ArrivalDestination,
  now: Date = new Date(),
  options: ArrivalOptions = {},
): string | null {
  const today = civilDateInSaoPaulo(now);

  if (isPickupRate(rate)) {
    const context: DeliveryContext = options.context ?? { holidays: holidaysPadrao(), store: DEFAULT_STORE_PLACE };
    return formatPickup(dispatchDate(now, context), today);
  }

  const arrival = arrivalDateForRate(rate, destination, now, options);
  return arrival ? formatArrival(arrival, today) : null;
}
