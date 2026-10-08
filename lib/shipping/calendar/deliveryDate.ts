/**
 * PRAZO DE ENTREGA "AMIGÁVEL": a data prevista de chegada, em dias úteis, com
 * feriados e horário de corte, escrita como o cliente fala ("Chega quinta,
 * dia 9"). Código puro: o relógio entra de fora, para o teste andar no tempo.
 *
 * REGRAS (todas configuráveis; os padrões são os da Persi, decididos em
 * 07/10/2026, e vão virar tela no painel):
 *
 *   corte    pedido feito até as 13h (dias de semana) ou 10h30 (sábado) sai no
 *            mesmo dia; depois disso, no próximo dia de operação da loja;
 *   operação a loja separa e despacha de segunda a sábado, menos em feriado;
 *   trânsito o prazo da transportadora (Melhor Envio) é em dias úteis de
 *            segunda a sexta, menos feriados nacionais, do estado e do
 *            município de DESTINO (o feriado da loja só decide o dia de saída);
 *   própria  a entrega da loja (Jundiaí e cidades vizinhas) conta dias de
 *            OPERAÇÃO (segunda a sábado), conforme a regra da zona.
 */

import {
  addDays,
  civilDateInSaoPaulo,
  diffInDays,
  minutesOfDayInSaoPaulo,
  mondayOf,
  parseCivilDate,
  parseTimeOfDay,
  weekdayOf,
  type CivilDate,
} from "./civilDate.ts";
import { findHoliday, type Holiday, type HolidayPlace } from "./holidays.ts";

export interface CutoffRule {
  /** Segunda a sexta. */
  weekday: string;
  saturday: string;
}

export const DEFAULT_CUTOFF: CutoffRule = { weekday: "13:00", saturday: "10:30" };

/** A loja, para os feriados municipais e estaduais dela. */
export const DEFAULT_STORE_PLACE: HolidayPlace = { uf: "SP", city: "Jundiaí" };

/** Segunda (1) a sábado (6). */
export const DEFAULT_OPERATING_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6];
/** Trânsito de transportadora: segunda (1) a sexta (5). */
export const CARRIER_BUSINESS_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

export interface DeliveryContext {
  holidays: readonly Holiday[];
  store?: HolidayPlace;
  cutoff?: CutoffRule;
  operatingWeekdays?: readonly number[];
}

function cutoffMinutes(date: CivilDate, cutoff: CutoffRule): number {
  const text = weekdayOf(date) === 6 ? cutoff.saturday : cutoff.weekday;
  return parseTimeOfDay(text) ?? parseTimeOfDay(weekdayOf(date) === 6 ? DEFAULT_CUTOFF.saturday : DEFAULT_CUTOFF.weekday) ?? 0;
}

function isHolidayAnywhere(date: CivilDate, context: DeliveryContext, extraPlaces: readonly HolidayPlace[] = []): boolean {
  const places = [context.store ?? DEFAULT_STORE_PLACE, ...extraPlaces];
  return findHoliday(date, context.holidays, places) !== null;
}

/** A loja trabalha neste dia? (dia da semana de operação e não é feriado dela) */
export function isOperatingDay(date: CivilDate, context: DeliveryContext): boolean {
  const weekdays = context.operatingWeekdays ?? DEFAULT_OPERATING_WEEKDAYS;
  return weekdays.includes(weekdayOf(date)) && !isHolidayAnywhere(date, context);
}

export function nextOperatingDay(after: CivilDate, context: DeliveryContext): CivilDate {
  let date = addDays(after, 1);
  for (let guard = 0; guard < 60 && !isOperatingDay(date, context); guard += 1) date = addDays(date, 1);
  return date;
}

/**
 * O dia em que o pedido sai da loja: hoje, se hoje é dia de operação e o corte
 * ainda não passou; senão, o próximo dia de operação.
 */
export function dispatchDate(now: Date, context: DeliveryContext): CivilDate {
  const today = civilDateInSaoPaulo(now);
  const cutoff = context.cutoff ?? DEFAULT_CUTOFF;
  if (isOperatingDay(today, context) && minutesOfDayInSaoPaulo(now) < cutoffMinutes(today, cutoff)) return today;
  return nextOperatingDay(today, context);
}

/**
 * Soma `days` dias úteis depois de `from` (segunda a sexta, sem feriado
 * nacional, do estado ou do município de DESTINO). `days` = 0 devolve `from`
 * (a data em que sai).
 *
 * O feriado municipal da LOJA não entra aqui: depois que o pacote sai, ele não
 * atrasa o trânsito — só decide em que dia o pedido pode sair (`dispatchDate`).
 */
export function addBusinessDays(
  from: CivilDate,
  days: number,
  context: DeliveryContext,
  destination: HolidayPlace = {},
): CivilDate {
  const places: HolidayPlace[] = [{ uf: (context.store ?? DEFAULT_STORE_PLACE).uf }, destination];
  let date = from;
  let remaining = Math.max(0, Math.floor(days));
  for (let guard = 0; remaining > 0 && guard < 400; guard += 1) {
    date = addDays(date, 1);
    const businessDay =
      CARRIER_BUSINESS_WEEKDAYS.includes(weekdayOf(date)) && findHoliday(date, context.holidays, places) === null;
    if (businessDay) remaining -= 1;
  }
  return date;
}

/**
 * Previsão de chegada por TRANSPORTADORA: sai no dia do despacho e leva
 * `transitDays` dias úteis (o `delivery_time` do Melhor Envio, mais os dias
 * extras configurados).
 */
export function estimateCarrierArrival(
  now: Date,
  transitDays: number,
  context: DeliveryContext,
  destination: HolidayPlace = {},
): CivilDate {
  return addBusinessDays(dispatchDate(now, context), transitDays, context, destination);
}

/**
 * Previsão de chegada por ENTREGA PRÓPRIA: sai no dia do despacho e leva
 * `operatingDays` dias de operação da loja (0 = no mesmo dia do despacho).
 */
export function estimateOwnDeliveryArrival(now: Date, operatingDays: number, context: DeliveryContext): CivilDate {
  let date = dispatchDate(now, context);
  for (let remaining = Math.max(0, Math.floor(operatingDays)), guard = 0; remaining > 0 && guard < 60; guard += 1) {
    date = nextOperatingDay(date, context);
    remaining -= 1;
  }
  return date;
}

// ---------------------------------------------------------------------------
// O texto
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * RETIRADA NA LOJA: "Retire hoje" (pedido antes do corte, em dia de operação) ou
 * "Retire a partir de amanhã, dia 8" / "Retire a partir de terça, dia 13" (o
 * próximo dia de trabalho da loja, pulando domingo e feriado). Usa o mesmo
 * corte do despacho.
 */
export function formatPickup(date: CivilDate, today: CivilDate): string {
  const diff = diffInDays(today, date);
  const { day, month } = parseCivilDate(date);
  if (diff <= 0) return "Retire hoje";
  if (diff === 1) return `Retire a partir de amanhã, dia ${day}`;

  const weekday = WEEKDAY_NAMES[weekdayOf(date)];
  const weeksAhead = diffInDays(mondayOf(today), mondayOf(date)) / 7;
  if (weeksAhead <= 1) return `Retire a partir de ${weekday}, dia ${day}`;
  return `Retire a partir de ${weekday}, dia ${day} de ${MONTH_NAMES[month - 1]}`;
}

/**
 * "Chega hoje", "Chega amanhã, dia 7", "Chega quinta, dia 9" (nesta semana),
 * "Chega até a próxima terça, dia 13" (semana que vem) e, mais longe,
 * "Chega até sexta, dia 23 de outubro". A semana vai de segunda a domingo.
 */
export function formatArrival(arrival: CivilDate, today: CivilDate): string {
  const diff = diffInDays(today, arrival);
  const { day, month } = parseCivilDate(arrival);
  const weekday = WEEKDAY_NAMES[weekdayOf(arrival)];

  if (diff <= 0) return "Chega hoje";
  if (diff === 1) return `Chega amanhã, dia ${day}`;

  const weeksAhead = diffInDays(mondayOf(today), mondayOf(arrival)) / 7;
  if (weeksAhead === 0) return `Chega ${weekday}, dia ${day}`;
  if (weeksAhead === 1) return `Chega até a próxima ${weekday}, dia ${day}`;
  return `Chega até ${weekday}, dia ${day} de ${MONTH_NAMES[month - 1]}`;
}
